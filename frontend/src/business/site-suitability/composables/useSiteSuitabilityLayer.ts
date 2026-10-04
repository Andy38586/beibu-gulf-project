/**
 * useSiteSuitabilityLayer — 新选址分析热力图层（单元五）：
 * 注册经 useOwnedLayers（归属册），更新走 BusinessLayerManager.updateData；
 * 渲染为热力图（weightField='score'），权重/过滤变化由页面防抖后调 update。
 * 请求直连统一入口 useApiRequest（契约 schema 校验在 HTTP 边界）。
 * 成功响应发布到 store.data（左上得分分布 / 左下 Top-N 面板消费）。
 */
import { computed, type ComputedRef, nextTick, onScopeDispose, watch } from 'vue'
import { useRouter } from 'vue-router'

import { type BusinessLayerManager, useBusinessLayers, useOwnedLayers } from '@/core'
import {
  ApiError,
  BoundedMap,
  ENDPOINTS,
  handleAuthError,
  isAuthError,
  showError,
  SITE_SUITABILITY_LAYER_KEY,
  useApiRequest,
  useSlowRequestOffer,
} from '@/shared'
import { logger } from '@/shared'
import { useSiteSuitabilityStore } from '@/stores'
import { useMapStore, useTaskStore } from '@/stores'
import type { LayerOptions, LayerType, MapRenderer } from '@/types'
import type { SiteSuitabilityResponseParsed } from '@/types/schemas'
import { siteSuitabilityResponseSchema } from '@/types/schemas'

import { useSiteSuitabilityRequest } from './useSiteSuitabilityRequest'

const LAYER_LABEL = '选址分析'

/**
 * 本页路由标识（taskStore 按 route 分槽的 key）。
 * 与 business/manifest.ts 的 path 是同一个值；写法沿用浸没页的 FLOOD_ROUTE_PATH 先例
 * （页面路由表是权威，这里是消费方持有的 key，不是第二份路由表）。
 */
const SITE_SUITABILITY_ROUTE_PATH = '/site-suitability'

/**
 * 展示用聚合分辨率（度）：0.02° ≈ 2.2km。设 0 可退回全分辨率（调试用）。
 *
 * 实测（2026-10-02，全量 142,477 格 / 本机直连 3000 端口）：
 *   0（全量）28.8MB · 0.01° 5.8MB/29,116 格 · **0.02° 1.5MB/7,490 格（19×）**
 *   · 0.03° 0.68MB/3,371 格 · 0.05° 0.26MB/1,280 格
 * 取 0.02°：对区域级热力图视觉无损，payload 已回到"秒开"量级；需要更细时调小该值即可。
 */
const DISPLAY_RESOLUTION_DEG = 0.02
const LAYER_TYPE: LayerType = 'heatmap'

/** 热力图色带与渲染参数（与预测图层同款形式，weightField 改 score） */
const GRADIENT = ['#00f', '#0ff', '#0f0', '#ff0', '#f00']

function getLayerOptions(): LayerOptions {
  return { weightField: 'score', radius: 18, blur: 14, gradient: GRADIENT }
}

interface UseSiteSuitabilityLayerReturn {
  updateLayer: (transactionId: number, signal: AbortSignal) => Promise<void>
  renderer: ComputedRef<MapRenderer | null>
}

export function useSiteSuitabilityLayer(): UseSiteSuitabilityLayerReturn {
  const router = useRouter()
  const state = useSiteSuitabilityStore()
  const mapStore = useMapStore()
  const { manager } = useBusinessLayers() as { manager: BusinessLayerManager }
  const { runInTransaction, isTransactionValid } = useSiteSuitabilityRequest()
  const { apiRequest } = useApiRequest()
  const taskStore = useTaskStore()

  const renderer = computed<MapRenderer | null>(() => mapStore.currentRenderer)

  const owned = useOwnedLayers('site-suitability')
  let disposed = false
  onScopeDispose(() => {
    disposed = true
  })

  // 渲染器就绪即注册（visible 跟随页面激活）
  watch(
    () => renderer.value,
    async (r) => {
      if (!r) return
      await nextTick()
      if (disposed) return
      if (!manager.has(SITE_SUITABILITY_LAYER_KEY)) {
        owned.register(SITE_SUITABILITY_LAYER_KEY, {
          label: LAYER_LABEL,
          layerType: LAYER_TYPE,
          data: null,
          options: getLayerOptions(),
          visible: true,
        })
      }
    },
    { immediate: true }
  )

  // LRU 缓存：同 (权重指纹, minLandFrac) 只请求一次
  const MAX_CACHE = 20
  const requestCache = new BoundedMap<string, SiteSuitabilityResponseParsed>(MAX_CACHE)

  function cacheKey(weights: Record<string, number>, minLandFrac: number): string {
    const w = Object.keys(weights)
      .sort()
      .map((k) => `${k}:${weights[k]}`)
      .join(',')
    return `${w}|${minLandFrac}`
  }

  /** 直连 apiRequest 的 params 值与 task 提交的 params 值共用同一形状（否则两侧各写一份类型） */
  type RequestParams = Record<string, string | number | boolean | null | undefined>

  /** 请求参数：直连与转后台**共用同一构造函数** ⇒ 不会长出第二份参数源（禁忌 7） */
  function buildRequestParams(): RequestParams {
    const weights = state.normalizedWeights()
    return {
      ...Object.fromEntries(Object.entries(weights).map(([k, v]) => [`w_${k}`, v])),
      min_land_frac: state.minLandFrac,
      // 性能治本（2026-10-02）：全量 14 万格 ≈ 28.8MB 响应 ⇒ 浏览器解析即卡。
      // 热力图按 ~1km 粗格聚合（服务端 AVG + 众数）在视觉上等价，payload 降 30-50×。
      resolution: DISPLAY_RESOLUTION_DEG,
    }
  }

  /**
   * 转后台（方案 A「慢请求自动提议转后台」，2026-10-02 用户批准）：
   * 用**同一份参数**提交 task，用户即可离开本页；结果到了走与直连**完全相同**的写入口
   * （setData + manager.updateData），不复制渲染逻辑。
   */
  async function transferToBackground(): Promise<void> {
    try {
      await taskStore.submit({
        route: SITE_SUITABILITY_ROUTE_PATH,
        domain: 'site-suitability-map',
        params: buildRequestParams(),
      })
    } catch (e) {
      // 队列满/限流等失败必须说出来：静默失败会让用户以为已经在后台跑了
      showError(e, { fallback: '转到后台失败，请稍后重试' })
      return
    }
    // docked = 用户主动让位（展示语义 + 导航进度环的保留判据）
    taskStore.setDocked(SITE_SUITABILITY_ROUTE_PATH, true)

    const slot = await taskStore.waitForResult(SITE_SUITABILITY_ROUTE_PATH)
    if (disposed || !slot || slot.status !== 'done') return
    const result = slot.result as SiteSuitabilityResponseParsed | undefined
    if (!result || !Array.isArray(result.features)) return
    state.setData(result)
    manager.updateData(SITE_SUITABILITY_LAYER_KEY, {
      data: result.features,
      options: getLayerOptions(),
    })
  }

  const offer = useSlowRequestOffer({
    onAccept: () => {
      void transferToBackground()
    },
  })

  async function updateLayer(transactionId: number, signal: AbortSignal): Promise<void> {
    const r = renderer.value
    if (!r) return
    if (!manager.has(SITE_SUITABILITY_LAYER_KEY)) {
      await nextTick()
      if (!manager.has(SITE_SUITABILITY_LAYER_KEY)) {
        owned.register(SITE_SUITABILITY_LAYER_KEY, {
          label: LAYER_LABEL,
          layerType: LAYER_TYPE,
          data: null,
          options: getLayerOptions(),
          visible: true,
        })
      }
    }

    const weights = state.normalizedWeights()
    const minLandFrac = state.minLandFrac
    const key = cacheKey(weights, minLandFrac)

    try {
      const cached = requestCache.get(key)
      if (cached) {
        if (!isTransactionValid(transactionId)) return
        state.setData(cached)
        // 缓存命中不发请求：清掉上一条被本事务取代的在途请求留下的 loading
        //（旧事务的 finally 见事务已失效不会回写，否则 loading 会永久悬停）
        state.setIsRequesting(false)
        manager.updateData(SITE_SUITABILITY_LAYER_KEY, {
          data: cached.features,
          options: getLayerOptions(),
        })
        return
      }

      if (!isTransactionValid(transactionId)) return

      // 请求进行态的唯一写入口：useSiteSuitabilityRequest 只维护事务 ID，面板 loading
      // 依赖 store.isRequesting；旧事务结束时不回写，避免清掉新事务的 loading。
      state.setIsRequesting(true)
      let geojson: SiteSuitabilityResponseParsed | null = null
      try {
        const params = buildRequestParams()
        geojson = await runInTransaction(
          () =>
            // 方案 A：超阈值就提议转后台（阈值内返回 ⇒ 零打扰）
            offer.track(() =>
              apiRequest<SiteSuitabilityResponseParsed>(ENDPOINTS.siteSuitability.map, {
                method: 'GET',
                params,
                signal,
                schema: siteSuitabilityResponseSchema,
              })
            ),
          transactionId
        )
      } finally {
        if (isTransactionValid(transactionId)) state.setIsRequesting(false)
      }
      if (!geojson) return

      state.setData(geojson)
      requestCache.set(key, geojson)
      manager.updateData(SITE_SUITABILITY_LAYER_KEY, {
        data: geojson.features,
        options: getLayerOptions(),
      })
    } catch (e) {
      if (isAuthError(e)) {
        void handleAuthError(router)
        return
      }
      if (e instanceof ApiError && e.message.includes('过于频繁')) {
        if (import.meta.env.DEV) logger.debug('[site-suitability] 限流，跳过:', e.message)
        return
      }
      if (import.meta.env.DEV) logger.debug('[site-suitability] 更新失败:', e)
      showError(e, { fallback: '更新选址分析图层失败' })
    }
  }

  return { updateLayer, renderer }
}

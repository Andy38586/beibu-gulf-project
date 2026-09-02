/**
 * useForecastLayer — 预测分析图层管理：每个指标对应独立图层（key: forecast-{indicator}），
 * 切换指标时自动显隐，LayerControlPanel 列出全部 4 个条目
 */
import type { ComputedRef } from 'vue'
import { computed, nextTick, onScopeDispose, watch } from 'vue'
import { useRouter } from 'vue-router'

import { type BusinessLayerManager, useBusinessLayers } from '@/core'
import { ApiError, ENDPOINTS, handleAuthError, isAuthError, showError, useApiRequest } from '@/shared'
import { logger } from '@/shared'
import { DEFAULT_CONFIDENCE } from '@/shared'
import { useForecastStore } from '@/stores'
import { useMapStore } from '@/stores'
import type { LayerOptions, LayerType, MapRenderer } from '@/types'
import type { ForecastMapData } from '@/types/api/forecast'
import { forecastMapDataSchema } from '@/types/schemas'

import { useForecastRequest } from './useForecastRequest'

const INDICATORS = ['cargo', 'container', 'berth', 'traffic'] as const
const INDICATOR_LABELS: Record<string, string> = {
  cargo: '货物吞吐量热力',
  container: '集装箱吞吐量热力',
  berth: '泊位分布',
  traffic: '船舶流量',
}
const LAYER_TYPES: Record<string, LayerType> = {
  cargo: 'heatmap',
  container: 'heatmap',
  berth: 'geojson',
  traffic: 'geojson',
}
const FEATURE_TYPES: Record<string, string> = {
  berth: 'forecast-berth',
  traffic: 'forecast-traffic',
}

/** 热力图色带（显式常量，不散落魔法数组） */
const FORECAST_HEATMAP_GRADIENT = ['#00f', '#0ff', '#0f0', '#ff0', '#f00']

/** useForecastLayer 返回值 */
interface UseForecastLayerReturn {
  updateForecastLayer: (transactionId: number, signal: AbortSignal) => Promise<void>
  removeForecastLayer: () => void
  renderer: ComputedRef<MapRenderer | null>
}

export function useForecastLayer(): UseForecastLayerReturn {
  const router = useRouter()
  const forecastState = useForecastStore()
  const mapStore = useMapStore()
  const { manager } = useBusinessLayers() as { manager: BusinessLayerManager }
  const { runInTransaction, isTransactionValid } = useForecastRequest()
  const { apiRequest } = useApiRequest()

  const renderer = computed<MapRenderer | null>(() => mapStore.currentRenderer)

  // 卸载标志：watch 回调里 nextTick 后组件可能已卸载，
  // 拦截防止注册孤儿图层（图层无宿主，跨路由残留）
  let disposed = false
  onScopeDispose(() => {
    disposed = true
  })

  // 合并 watch：同时监听 renderer 和 activeIndicator，确保图层状态同步
  watch(
    [() => renderer.value, () => forecastState.activeIndicator],
    async ([r, newInd], [_oldR, oldInd]) => {
      if (!r) return

      // 延迟到下一帧，确保渲染器完全初始化
      await nextTick()
      if (disposed) return

      // 渲染器就绪时注册全部 4 个图层
      for (const indicator of INDICATORS) {
        const key = `forecast-${indicator}`
        if (manager.has(key)) continue
        const isActive = indicator === newInd
        manager.register(key, {
          label: INDICATOR_LABELS[indicator],
          layerType: LAYER_TYPES[indicator],
          data: null,
          options: getLayerOptions(indicator),
          visible: isActive,
        })
      }

      // 指标切换时更新图层可见性：old 隐藏；new 尊重 registry——
      // 用户手动隐藏过的层（renderer 已有实例）不强制重开，仅首次激活（无实例）自动显示
      if (oldInd && oldInd !== newInd) {
        const oldKey = `forecast-${oldInd}`
        if (manager.has(oldKey)) manager.setVisible(oldKey, false)
      }
      const newKey = `forecast-${newInd}`
      if (manager.has(newKey)) {
        const renderedBefore = r.hasLayer?.(newKey) ?? false
        if (!renderedBefore) manager.setVisible(newKey, true)
      }
    },
    { immediate: true }
  )

  function getLayerOptions(indicator: string): LayerOptions {
    if (indicator === 'cargo' || indicator === 'container') {
      // 显式传入 gradient，使热力图色带可配置（不再依赖 renderer 默认值）
      return {
        weightField: 'value',
        radius: 20,
        blur: 15,
        gradient: FORECAST_HEATMAP_GRADIENT,
      }
    }
    const ft = FEATURE_TYPES[indicator]
    return ft ? { featureType: ft } : {}
  }

  function getRenderData(
    layerType: LayerType,
    geojson: ForecastMapData
  ): ForecastMapData['features'] | ForecastMapData {
    if (layerType === 'heatmap') return geojson.features || []
    return geojson
  }

  // 地图数据 LRU 缓存：同一 (indicator, time, confidence) 只请求一次，播放/拖动重放同时间点零请求
  const MAX_MAP_CACHE = 100
  const mapRequestCache = new Map<string, ForecastMapData>()
  function mapCacheKey(indicator: string, time: string, confidence: number): string {
    return `map:${indicator}:${time}:${confidence}`
  }

  async function updateForecastLayer(transactionId: number, signal: AbortSignal): Promise<void> {
    const r = renderer.value
    if (!r) return

    const indicator = forecastState.activeIndicator
    const rawTime = forecastState.currentTime
    const time = rawTime.includes('-') ? rawTime : `${rawTime}-12`
    const key = `forecast-${indicator}`

    // 检查图层是否已注册，若未注册则先注册
    if (!manager.has(key)) {
      await nextTick()
      if (!manager.has(key)) {
        manager.register(key, {
          label: INDICATOR_LABELS[indicator],
          layerType: LAYER_TYPES[indicator],
          data: null,
          options: getLayerOptions(indicator),
          visible: true,
        })
      }
    }

    try {
      const confidence = forecastState.confidenceThresholds[indicator] || DEFAULT_CONFIDENCE
      const cacheKey = mapCacheKey(indicator, time, confidence)
      const layerType = LAYER_TYPES[indicator]
      const options = getLayerOptions(indicator)

      // LRU 命中：播放/拖动重放同一时间点，直接渲染缓存，零请求
      const cached = mapRequestCache.get(cacheKey)
      if (cached) {
        // 816-专项8 发现3：缓存命中也校验事务有效性（对齐 useForecastTimeseries 8-12 模式）——
        // 滑块快速连点（事务 A→B→C）时，旧事务 B 的缓存命中不得写回画面（「最后操作=最新结果」）
        if (!isTransactionValid(transactionId)) return
        manager.updateData(key, { data: getRenderData(layerType, cached), options })
        return
      }

      const geojson = await runInTransaction(
        // 预测纯 api，直连统一入口 useApiRequest
        () =>
          apiRequest<ForecastMapData>(ENDPOINTS.forecast.map, {
            method: 'GET',
            params: { indicator, time, confidence },
            signal,
            schema: forecastMapDataSchema,
          }),
        transactionId
      )

      // 事务过期或请求被取消
      if (geojson === null) return
      if (!geojson) return

      // 写缓存（LRU 上限，超限删最早键）
      if (mapRequestCache.size >= MAX_MAP_CACHE) {
        const oldestKey = mapRequestCache.keys().next().value
        if (oldestKey !== undefined) mapRequestCache.delete(oldestKey)
      }
      mapRequestCache.set(cacheKey, geojson)

      manager.updateData(key, { data: getRenderData(layerType, geojson), options })
    } catch (e) {
      if (isAuthError(e)) {
        void handleAuthError(router)
        return
      }
      // 播放中命中限流（429）静默降级不弹窗（连续高频交互，弹窗打断演示）；手动操作照常提示
      if (forecastState.isPlaying && e instanceof ApiError && e.message.includes('过于频繁')) {
        if (import.meta.env.DEV)
          logger.debug('[useForecastLayer] 播放中请求被限流，跳过该时间点:', e.message)
        return
      }
      if (import.meta.env.DEV) logger.debug('[useForecastLayer] 更新失败:', e)
      showError(e, { fallback: '更新地图图层失败' })
    }
  }

  function removeForecastLayer(): void {
    for (const indicator of INDICATORS) {
      const key = `forecast-${indicator}`
      if (manager.has(key)) manager.remove(key)
    }
  }

  return { updateForecastLayer, removeForecastLayer, renderer }
}

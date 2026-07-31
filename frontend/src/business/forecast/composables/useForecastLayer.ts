/**
 * useForecastLayer — 预测分析图层管理
 *
 * 每个指标对应独立图层，key 格式: forecast-{indicator}
 * 切换指标时自动显隐，LayerControlPanel 列出全部 4 个条目
 */
import type { ComputedRef } from 'vue'
import { computed, nextTick, watch } from 'vue'

import type { BusinessLayerManager } from '@/core/map/BusinessLayerManager'
import { useBusinessLayers } from '@/core/map/composables/useBusinessLayers'
import type { ForecastMapData } from '@/services/adapters/forecastAdapter'
import { forecastAdapter } from '@/services/adapters/forecastAdapter'
import { handleAuthError, isAuthError, showError } from '@/shared/utils/errorHandler'
import { useForecastState } from '@/stores/forecastState'
import { useMapStore } from '@/stores/mapStore'
import type { LayerOptions, LayerType, MapRenderer } from '@/types'

import { DEFAULT_CONFIDENCE } from '../constants'

import { useForecastRequest } from './useForecastRequest'

const INDICATORS = ['throughput', 'berth', 'traffic', 'pressure'] as const
const INDICATOR_LABELS: Record<string, string> = {
  throughput: '吞吐量热力',
  berth: '泊位分布',
  traffic: '船舶流量',
  pressure: '物流压力',
}
const LAYER_TYPES: Record<string, LayerType> = {
  throughput: 'heatmap',
  berth: 'geojson',
  traffic: 'geojson',
  pressure: 'geojson',
}
const FEATURE_TYPES: Record<string, string> = {
  berth: 'forecast-berth',
  traffic: 'forecast-traffic',
  pressure: 'forecast-pressure',
}

/** useForecastLayer 返回值 */
interface UseForecastLayerReturn {
  updateForecastLayer: (transactionId: number, signal: AbortSignal) => Promise<void>
  removeForecastLayer: () => void
  renderer: ComputedRef<MapRenderer | null>
}

export function useForecastLayer(): UseForecastLayerReturn {
  const forecastState = useForecastState()
  const mapStore = useMapStore()
  const { manager } = useBusinessLayers() as { manager: BusinessLayerManager }
  const { runInTransaction } = useForecastRequest()

  const renderer = computed<MapRenderer | null>(() => mapStore.currentRenderer)

  // 合并 watch：同时监听 renderer 和 activeIndicator，确保图层状态同步
  watch(
    [() => renderer.value, () => forecastState.activeIndicator],
    async ([r, newInd], [_oldR, oldInd]) => {
      if (!r) return

      // 延迟到下一帧，确保渲染器完全初始化
      await nextTick()

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

      // 指标切换时更新图层可见性
      if (oldInd && oldInd !== newInd) {
        const oldKey = `forecast-${oldInd}`
        if (manager.has(oldKey)) manager.setVisible(oldKey, false)
      }
      const newKey = `forecast-${newInd}`
      if (manager.has(newKey)) manager.setVisible(newKey, true)
    },
    { immediate: true }
  )

  function getLayerOptions(indicator: string): LayerOptions {
    if (indicator === 'throughput') {
      // heatmap 专属字段（weightField/radius/blur）不在 LayerOptions 内，
      // 由 heatmap adapter 按业务契约读取；此处断言以保持运行时数据不变。
      return { weightField: 'value', radius: 20, blur: 15 } as unknown as LayerOptions
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
      const geojson = await runInTransaction(
        () => forecastAdapter.getMapData(indicator, time, confidence, signal),
        transactionId
      )

      // 事务过期或请求被取消
      if (geojson === null) return
      if (!geojson) return

      const layerType = LAYER_TYPES[indicator]
      const data = getRenderData(layerType, geojson)
      const options = getLayerOptions(indicator)

      manager.updateData(key, { data, options })
    } catch (e) {
      if (isAuthError(e)) {
        handleAuthError()
        return
      }
      if (import.meta.env.DEV) console.error('[useForecastLayer] 更新失败:', e)
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

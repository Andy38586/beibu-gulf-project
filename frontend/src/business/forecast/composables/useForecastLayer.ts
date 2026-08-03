/**
 * useForecastLayer — 预测分析图层管理
 *
 * 每个指标对应独立图层，key 格式: forecast-{indicator}
 * 切换指标时自动显隐，LayerControlPanel 列出全部 4 个条目
 */
import type { ComputedRef } from 'vue'
import { computed, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'

import { type BusinessLayerManager, useBusinessLayers } from '@/core'
import type { ForecastMapData } from '@/services'
import { forecastAdapter } from '@/services'
import { handleAuthError, isAuthError, showError } from '@/shared'
import { logger } from '@/shared'
import { useForecastState } from '@/stores'
import { useMapStore } from '@/stores'
import type { LayerOptions, LayerType, MapRenderer } from '@/types'

import { DEFAULT_CONFIDENCE } from '../constants'

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

/** useForecastLayer 返回值 */
interface UseForecastLayerReturn {
  updateForecastLayer: (transactionId: number, signal: AbortSignal) => Promise<void>
  removeForecastLayer: () => void
  renderer: ComputedRef<MapRenderer | null>
}

export function useForecastLayer(): UseForecastLayerReturn {
  const router = useRouter()
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
    if (indicator === 'cargo' || indicator === 'container') {
      // a015: 显式传入 gradient，使热力图色带可配置（不再依赖 renderer 默认值）
      return {
        weightField: 'value',
        radius: 20,
        blur: 15,
        gradient: ['#00f', '#0ff', '#0f0', '#ff0', '#f00'],
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
        void handleAuthError(router)
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

/**
 * useForecastLayer — 预测分析图层管理
 *
 * 每个指标对应独立图层，key 格式: forecast-{indicator}
 * 切换指标时自动显隐，LayerControlPanel 列出全部 4 个条目
 */
import { computed, watch, nextTick } from 'vue'
import { showError, handleAuthError, isAuthError } from '@/shared/utils/errorHandler'
import { useForecastState } from '@/stores/forecastState'
import { useBusinessLayers } from '@/core/map/composables/useBusinessLayers'
import { useForecastRequest } from './useForecastRequest'
import { useMapStore } from '@/stores/mapStore'

const INDICATORS = ['throughput', 'berth', 'traffic', 'pressure']
const INDICATOR_LABELS = {
  throughput: '吞吐量热力',
  berth: '泊位分布',
  traffic: '船舶流量',
  pressure: '物流压力',
}
const LAYER_TYPES = {
  throughput: 'heatmap',
  berth: 'geojson',
  traffic: 'geojson',
  pressure: 'geojson',
}
const FEATURE_TYPES = {
  berth: 'forecast-berth',
  traffic: 'forecast-traffic',
  pressure: 'forecast-pressure',
}

export function useForecastLayer() {
  const forecastState = useForecastState()
  const mapStore = useMapStore()
  const { manager } = useBusinessLayers()
  const { forecastApiRequest } = useForecastRequest()

  const renderer = computed(() => mapStore.currentRenderer)

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

  function getLayerOptions(indicator) {
    if (indicator === 'throughput') {
      return { weightField: 'value', radius: 20, blur: 15 }
    }
    const ft = FEATURE_TYPES[indicator]
    return ft ? { featureType: ft } : {}
  }

  function getRenderData(layerType, geojson) {
    if (layerType === 'heatmap') return geojson.features || []
    return geojson
  }

  async function updateForecastLayer(transactionId, signal) {
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
      const confidence = forecastState.confidenceThresholds[indicator] || 0.8
      const response = await forecastApiRequest(
        `/forecast/map?indicator=${indicator}&time=${time}&confidence=${confidence}`,
        transactionId,
        signal
      )

      // 事务过期或请求被取消
      if (response === null) return
      if (response.code !== 200 || !response.data) return

      const geojson = response.data
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

  function removeForecastLayer() {
    for (const indicator of INDICATORS) {
      const key = `forecast-${indicator}`
      if (manager.has(key)) manager.remove(key)
    }
  }

  return { updateForecastLayer, removeForecastLayer, renderer }
}

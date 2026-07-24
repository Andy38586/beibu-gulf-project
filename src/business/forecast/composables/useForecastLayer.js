/**
 * useForecastLayer — 预测分析图层管理
 *
 * 通过 BusinessLayerManager 管理动态图层生命周期。
 * 组件不再直接调用 renderer 方法。
 */
import { computed } from 'vue'
import { useForecastState } from '@/stores/forecastState'
import { useBusinessLayers } from '@/core/map/composables/useBusinessLayers'
import { useApiRequest } from '@/shared/composables/useApiRequest'
import { useMapStore } from '@/stores/map'

export function useForecastLayer() {
  const forecastState = useForecastState()
  const mapStore = useMapStore()
  const { manager } = useBusinessLayers()
  const { apiRequest } = useApiRequest()

  const currentLayerKey = 'forecast-layer'
  let layerReqSeq = 0

  const renderer = computed(() => mapStore.currentRenderer)

  const INDICATOR_LABELS = {
    throughput: '吞吐量热力',
    berth: '泊位利用率',
    traffic: '船舶流量',
    pressure: '物流压力',
  }

  function getLayerType(indicator) {
    if (indicator === 'throughput') return 'heatmap'
    return 'geojson'
  }

  function getLayerOptions(indicator, geojson) {
    if (indicator === 'throughput') {
      return { weightField: 'value', radius: 20, blur: 15 }
    }
    // berth / traffic / pressure 的 per-feature 样式由各自的 style 回调处理
    return {}
  }

  function getGeoJsonOptions(indicator) {
    if (indicator === 'berth') return { featureType: 'forecast-berth' }
    if (indicator === 'traffic') return { featureType: 'forecast-traffic' }
    if (indicator === 'pressure') return { featureType: 'forecast-pressure' }
    return {}
  }

  async function updateForecastLayer() {
    const r = renderer.value
    if (!r) return

    const indicator = forecastState.activeIndicator
    const rawTime = forecastState.currentTime
    const time = rawTime.includes('-') ? rawTime : `${rawTime}-12`

    try {
      const seq = ++layerReqSeq
      const confidence = forecastState.confidenceThresholds[indicator] || 0.8
      const response = await apiRequest(`/forecast/map?indicator=${indicator}&time=${time}&confidence=${confidence}`)

      if (seq !== layerReqSeq) return

      if (response.code !== 200 || !response.data) {
        if (import.meta.env.DEV) console.warn('[useForecastLayer] 数据为空', response)
        return
      }

      const geojson = response.data
      const layerType = getLayerType(indicator)
      const label = INDICATOR_LABELS[indicator] || indicator
      const baseOptions = getLayerOptions(indicator, geojson)
      const geojsonOptions = getGeoJsonOptions(indicator)

      const options = { ...baseOptions, ...geojsonOptions }
      const existingMeta = manager.getMeta(currentLayerKey)

      // 指标切换导致 layerType 变化时，先移除旧图层再重新注册
      if (existingMeta && existingMeta.layerType !== layerType) {
        manager.remove(currentLayerKey)
      }

      if (!manager.has(currentLayerKey)) {
        // 首次注册 → 默认显示
        manager.register(currentLayerKey, {
          label,
          layerType,
          data: getRenderData(layerType, geojson, indicator),
          options,
          visible: true,
        })
      } else {
        // 已注册 → 只更新数据，不改变 visible
        manager.updateData(currentLayerKey, {
          data: getRenderData(layerType, geojson, indicator),
          options,
        })
      }
    } catch (e) {
      if (import.meta.env.DEV) console.error('[useForecastLayer] 更新预测图层失败:', e)
    }
  }

  function getRenderData(layerType, geojson, indicator) {
    if (layerType === 'heatmap') {
      // 热力图需要 features 数组
      return geojson.features || []
    }
    return geojson
  }

  function removeForecastLayer() {
    manager.remove(currentLayerKey)
    forecastState.activeForecastLayer = null
  }

  return { updateForecastLayer, removeForecastLayer, renderer }
}

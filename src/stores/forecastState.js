// TODO:3.1: 预测分析全局状态管理
// 与现有 store 一致，使用 .js 文件 + Pinia setup store 模式
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useForecastState = defineStore('forecast', () => {
  // ==================== 时间状态 ====================
  const currentTime = ref('2025-12')

  const timeRange = ref({
    start: '2023-01',
    end: '2035-12',
    current: '2025-12',
  })

  const timeGranularity = ref('month')

  const isPlaying = ref(false)

  const playSpeed = ref(500)

  // ==================== 指标状态 ====================
  const activeIndicator = ref('throughput')

  // TODO:6.3: 每个指标独立的置信度阈值
  const confidenceThresholds = ref({
    throughput: 0.8,
    berth: 0.8,
    traffic: 0.8,
    pressure: 0.8,
  })

  const activeForecastLayer = ref(null)

  // ==================== 数据状态 ====================
  // TODO:3.1: dataCache 用于 TODO:5.1 的数据流桥接（偏差4）
  const dataCache = ref(new Map())

  const currentData = computed(() => {
    return dataCache.value.get(currentTime.value) || null
  })

  // ==================== Actions ====================
  function setCurrentTime(time) {
    currentTime.value = time
  }

  function setTimeGranularity(granularity) {
    timeGranularity.value = granularity
  }

  function setActiveIndicator(indicator) {
    activeIndicator.value = indicator
  }

  function setConfidenceThreshold(indicator, value) {
    confidenceThresholds.value[indicator] = value
  }

  function cacheData(time, data) {
    dataCache.value.set(time, data)
  }

  function clearCache() {
    dataCache.value.clear()
  }

  function reset() {
    currentTime.value = '2025-12'
    activeIndicator.value = 'throughput'
    activeForecastLayer.value = null
    isPlaying.value = false
    clearCache()
  }

  return {
    currentTime,
    timeRange,
    timeGranularity,
    isPlaying,
    playSpeed,
    activeIndicator,
    confidenceThresholds,
    activeForecastLayer,
    dataCache,
    currentData,
    setCurrentTime,
    setTimeGranularity,
    setActiveIndicator,
    setConfidenceThreshold,
    cacheData,
    clearCache,
    reset,
  }
})

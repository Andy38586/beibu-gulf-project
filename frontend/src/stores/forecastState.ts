import { defineStore } from 'pinia'
import type { ComputedRef, Ref, ShallowRef } from 'vue'
import { computed, ref, shallowRef } from 'vue'

import { DEFAULT_CONFIDENCE } from '@/business/forecast/constants'
import type { ForecastSeries } from '@/types/api/forecast'
import type { ConfidenceThresholds, ForecastTimeRange } from '@/types/business/base'

export const useForecastState = defineStore('forecast', () => {
  const currentTime: Ref<string> = ref('2025-12')

  const timeRange: Ref<ForecastTimeRange> = ref({
    start: '2023-01',
    end: '2035-12',
    current: '2025-12',
  })

  const timeGranularity: Ref<string> = ref('month')
  const isPlaying: Ref<boolean> = ref(false)
  const playSpeed: Ref<number> = ref(500)
  const activeIndicator: Ref<string> = ref('throughput')

  const confidenceThresholds: Ref<ConfidenceThresholds> = ref({
    throughput: DEFAULT_CONFIDENCE,
    berth: DEFAULT_CONFIDENCE,
    traffic: DEFAULT_CONFIDENCE,
    pressure: DEFAULT_CONFIDENCE,
  })

  const activeForecastLayer: Ref<string | null> = ref(null)
  // shallowRef：Map 是可变结构，深度响应无意义且浪费性能（§7.7 约定）
  const dataCache: ShallowRef<Map<string, ForecastSeries>> = shallowRef(new Map())

  const currentData: ComputedRef<ForecastSeries | null> = computed(() => {
    return dataCache.value.get(currentTime.value) ?? null
  })

  function setCurrentTime(time: string): void {
    currentTime.value = time
  }

  function setTimeGranularity(granularity: string): void {
    timeGranularity.value = granularity
  }

  function setActiveIndicator(indicator: string): void {
    activeIndicator.value = indicator
  }

  function setConfidenceThreshold(indicator: string, value: number): void {
    confidenceThresholds.value[indicator] = value
  }

  function cacheData(time: string, data: ForecastSeries): void {
    // shallowRef 下需重赋值 .value 引用才能触发响应式（computed 才能侦测 Map 内部变更）
    const newMap = new Map(dataCache.value)
    newMap.set(time, data)
    dataCache.value = newMap
  }

  function clearCache(): void {
    dataCache.value = new Map()
  }

  function reset(): void {
    currentTime.value = '2025-12'
    timeRange.value = { start: '2023-01', end: '2035-12', current: '2025-12' }
    timeGranularity.value = 'month'
    isPlaying.value = false
    playSpeed.value = 500
    activeIndicator.value = 'throughput'
    confidenceThresholds.value = {
      throughput: DEFAULT_CONFIDENCE,
      berth: DEFAULT_CONFIDENCE,
      traffic: DEFAULT_CONFIDENCE,
      pressure: DEFAULT_CONFIDENCE,
    }
    activeForecastLayer.value = null
    dataCache.value = new Map()
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

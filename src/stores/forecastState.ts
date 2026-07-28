import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import type { ForecastTimeRange, ConfidenceThresholds } from '@/types/business/base'

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
    throughput: 0.8,
    berth: 0.8,
    traffic: 0.8,
    pressure: 0.8,
  })

  const activeForecastLayer: Ref<string | null> = ref(null)
  const dataCache: Ref<Map<string, unknown>> = ref(new Map())

  const currentData: ComputedRef<unknown | null> = computed(() => {
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

  function cacheData(time: string, data: unknown): void {
    dataCache.value.set(time, data)
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
    confidenceThresholds.value = { throughput: 0.8, berth: 0.8, traffic: 0.8, pressure: 0.8 }
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

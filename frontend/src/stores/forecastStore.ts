import { defineStore } from 'pinia'
import type { ComputedRef, Ref, ShallowRef } from 'vue'
import { computed, ref, shallowRef } from 'vue'

// 分层铁律：stores 不得引用 business——初始化所需共享常量一律从 shared 取
import { BASE_YEAR, DEFAULT_CONFIDENCE, END_YEAR } from '@/shared'
import type { ForecastSeries } from '@/types/api/forecast'
import type { ConfidenceThresholds, ForecastTimeRange } from '@/types/business/base'

import { createPersistedState } from './factories/createPersistedState'

/**
 * 预测分析跨页面状态快照（「跳转个人中心登录 → 返回原路由」链路：saveState → consumeState）。
 * Map 以 [key, value] 数组序列化（Map 不可直接入快照，且组件本地请求缓存卸载时会清空）；
 * isPlaying 不保存——播放是临时交互态，由组件内 interval 驱动，重挂载无法恢复。
 */
export interface ForecastSavedState {
  currentTime: string
  timeGranularity: string
  playSpeed: number
  activeIndicator: string
  confidenceThresholds: ConfidenceThresholds
  activeForecastLayer: string | null
  /** store 层数据缓存（currentData 即时可用） */
  dataCache: Array<[string, ForecastSeries]>
  /** 页面本地请求缓存（恢复后图表零请求重建） */
  requestCache: Array<[string, unknown]>
}

export const useForecastStore = defineStore('forecast', () => {
  const currentTime: Ref<string> = ref('2026-06')

  const timeRange: Ref<ForecastTimeRange> = ref({
    start: `${BASE_YEAR}-01`,
    end: `${END_YEAR}-12`,
    current: '2026-06',
  })

  const timeGranularity: Ref<string> = ref('month')
  const isPlaying: Ref<boolean> = ref(false)
  const playSpeed: Ref<number> = ref(500)
  const activeIndicator: Ref<string> = ref('cargo')

  const confidenceThresholds: Ref<ConfidenceThresholds> = ref({
    cargo: DEFAULT_CONFIDENCE,
    container: DEFAULT_CONFIDENCE,
    berth: DEFAULT_CONFIDENCE,
    traffic: DEFAULT_CONFIDENCE,
  })

  const activeForecastLayer: Ref<string | null> = ref(null)
  // shallowRef（浅响应式）：Map 为可变结构，深度追踪无意义且浪费性能
  const dataCache: ShallowRef<Map<string, ForecastSeries>> = shallowRef(new Map())

  /** 请求事务状态迁入 store（消除请求 composable 的模块级可变状态）；AbortController 不可序列化、不响应式，仍由请求实例持有并透传 signal */
  const activeTransactionId: Ref<number> = ref(0)
  const isRequesting: Ref<boolean> = ref(false)

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

  /** 事务状态重置（配合请求取消与组件卸载使用；reset() 也调用） */
  function resetTransactionState(): void {
    activeTransactionId.value = 0
    isRequesting.value = false
  }

  function reset(): void {
    currentTime.value = '2026-06'
    timeRange.value = { start: `${BASE_YEAR}-01`, end: `${END_YEAR}-12`, current: '2026-06' }
    timeGranularity.value = 'month'
    isPlaying.value = false
    playSpeed.value = 500
    activeIndicator.value = 'cargo'
    confidenceThresholds.value = {
      cargo: DEFAULT_CONFIDENCE,
      container: DEFAULT_CONFIDENCE,
      berth: DEFAULT_CONFIDENCE,
      traffic: DEFAULT_CONFIDENCE,
    }
    activeForecastLayer.value = null
    dataCache.value = new Map()
    // 一并复位事务状态（登出/路由切换重置全链路）
    resetTransactionState()
  }

  // ─── 跨页面持久化（与选址/洪涝同模式） ────────────────────
  // reset() 不清快照，保证「保存 → 卸载重置 → 返回恢复」链路成立
  const persisted = createPersistedState<ForecastSavedState>()

  /** 保存当前状态到快照（跳转登录时由页面 onBeforeRouteLeave 调用） */
  function saveState(payload: ForecastSavedState): void {
    persisted.saveState(payload)
  }

  /** 消费已保存的状态（一次性，返回后快照清空） */
  function consumeState(): ForecastSavedState | null {
    return persisted.consumeState()
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
    activeTransactionId,
    isRequesting,
    setCurrentTime,
    setTimeGranularity,
    setActiveIndicator,
    setConfidenceThreshold,
    resetTransactionState,
    reset,
    // 跨页面持久化
    hasPersistedState: persisted.hasPersistedState,
    saveState,
    consumeState,
  }
})

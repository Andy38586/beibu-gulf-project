import { defineStore } from 'pinia'
import type { ComputedRef, Ref, ShallowRef } from 'vue'
import { computed, ref, shallowRef } from 'vue'

// 分层铁律：stores → business 禁止引。DEFAULT_CONFIDENCE 是 store 初始化所需共享常量，
// 故从 shared/constants 取（business/forecast/constants 已 re-export 同源值）。
import { BASE_YEAR, DEFAULT_CONFIDENCE, END_YEAR } from '@/shared'
import type { ForecastSeries } from '@/types/api/forecast'
import type { ConfidenceThresholds, ForecastTimeRange } from '@/types/business/base'

import { createPersistedState } from './factories/createPersistedState'

/**
 * 预测分析跨页面状态快照（与 SiteSelectionState/FloodSavedState 同模式）
 * 「跳转个人中心登录 → 返回原路由」链路（onBeforeRouteLeave → saveState → consumeState）。
 * 说明：
 * - dataCache/requestCache 以 [key, value] 数组序列化（Map 不可直接入快照，
 *   且组件本地 requestCache 在 onUnmounted 会 clear()——存引用会连带清空快照）
 * - isPlaying 不保存：播放是临时交互状态，恢复后从暂停开始（interval 驱动在
 *   ForecastControlPanel 组件内，重新挂载无法自动重启）
 */
export interface ForecastSavedState {
  currentTime: string
  timeGranularity: string
  playSpeed: number
  activeIndicator: string
  confidenceThresholds: ConfidenceThresholds
  activeForecastLayer: string | null
  /** store 数据缓存（currentData computed 即时可用） */
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
  // shallowRef：Map 是可变结构，深度响应无意义且浪费性能（§7.7 约定）
  const dataCache: ShallowRef<Map<string, ForecastSeries>> = shallowRef(new Map())

  /**
   * 请求事务状态迁入 store（消除 useForecastRequest 模块级可变状态）。
   * - activeTransactionId：当前事务 ID，新事务 +1，旧事务 ID 失效
   * - isRequesting：当前是否有请求在途（替代原模块级 isLoading ref）
   * AbortController 不可序列化、不响应式，仍由 useForecastRequest 实例级持有，
   * 通过 startTransaction 返回的 signal 透传给 adapter。
   */
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

  function cacheData(time: string, data: ForecastSeries): void {
    // shallowRef 下需重赋值 .value 引用才能触发响应式（computed 才能侦测 Map 内部变更）
    const newMap = new Map(dataCache.value)
    newMap.set(time, data)
    dataCache.value = newMap
  }

  /**
   * 事务状态重置——配合 useForecastRequest.cancelAll 与组件卸载使用，
   * 使事务 ID 失效并复位 isRequesting。reset() 也调用此方法。
   */
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
    // 一并复位事务状态（与批次1 Part 6 联动：登出/路由切换重置全链路）
    resetTransactionState()
  }

  // ─── 跨页面持久化（与 SiteSelectionStore/FloodStore 同模式）────────────
  // reset() 不清快照：saveState → onUnmounted reset → 返回 consumeState 链路成立
  const persisted = createPersistedState<ForecastSavedState>()

  /**
   * 保存当前状态到快照（「跳转个人中心登录」时由页面 onBeforeRouteLeave 调用）
   * payload 为完整快照（store 状态 + 页面本地请求缓存）。
   */
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
    cacheData,
    resetTransactionState,
    reset,
    // 跨页面持久化
    hasPersistedState: persisted.hasPersistedState,
    saveState,
    consumeState,
  }
})

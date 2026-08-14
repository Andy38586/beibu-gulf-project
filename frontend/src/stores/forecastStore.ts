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

  // 页面请求缓存（跨页面快照序列化；Map 不可直接入快照，saveState 时转数组）。
  // 原为 ForecastPage 页面级 Map，C4 收口后迁入 store 统一管理（含快照恢复）
  const requestCache: ShallowRef<Map<string, unknown>> = shallowRef(new Map())
  /** requestCache 大小上限，超限删除最早键（Map 迭代序即插入序，近似 LRU） */
  const MAX_REQUEST_CACHE_ENTRIES = 50

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

  function setIsPlaying(playing: boolean): void {
    isPlaying.value = playing
  }

  /** 请求缓存写入（LRU 淘汰；页面/composable 统一入口，替代页面级 Map） */
  function setRequestCache(key: string, value: unknown): void {
    const map = requestCache.value
    if (map.size >= MAX_REQUEST_CACHE_ENTRIES) {
      const oldestKey = map.keys().next().value
      if (oldestKey !== undefined) map.delete(oldestKey)
    }
    map.set(key, value)
  }

  /** 清空请求缓存（组件卸载时调用） */
  function clearRequestCache(): void {
    requestCache.value = new Map()
  }

  /** 快照恢复（跨页面登录返回）：一次性批量写回（禁止调用方逐字段直改 state） */
  function restoreState(saved: ForecastSavedState): void {
    currentTime.value = saved.currentTime
    timeGranularity.value = saved.timeGranularity
    playSpeed.value = saved.playSpeed
    activeIndicator.value = saved.activeIndicator
    confidenceThresholds.value = { ...saved.confidenceThresholds }
    activeForecastLayer.value = saved.activeForecastLayer
    // shallowRef 需重赋值引用才触发响应式
    dataCache.value = new Map(saved.dataCache)
    requestCache.value = new Map(saved.requestCache)
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
    requestCache.value = new Map()
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

  /** 显式清空快照（登出时调用——reset() 刻意不清快照，登出必须清，见 App.vue resetStores） */
  function clearState(): void {
    persisted.clearPersistedState()
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
    requestCache,
    currentData,
    activeTransactionId,
    isRequesting,
    setCurrentTime,
    setTimeGranularity,
    setActiveIndicator,
    setConfidenceThreshold,
    setIsPlaying,
    setRequestCache,
    clearRequestCache,
    restoreState,
    resetTransactionState,
    reset,
    // 跨页面持久化
    hasPersistedState: persisted.hasPersistedState,
    saveState,
    consumeState,
    clearState,
  }
})

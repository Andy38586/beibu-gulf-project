import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type {
  AffectedFacility,
  FloodConsumedState,
  FloodFeature,
  FloodSavedState,
  FloodStatistics,
} from '@/types/business/base'

import { createPersistedState } from './factories/createPersistedState'

/**
 * 浸没分析统一 Store（Setup Store 风格）
 * 职责：
 * - UI 控制（floodActive / showFloodArea / showFloodPOI）
 * - 分析数据（floodStatistics / floodFeatures / floodRiskLevel）
 * - 跨页面状态持久化（saveState / consumeState / clearState）
 * 持久化策略：
 * - saveState 接收完整 FloodSavedState（含 waterLevel/affectedFacilities/totalLoss）
 * - consumeState 一次性返回全部字段，调用方无需跨 store 组合
 * - clearState 彻底重置（UI + 数据 + 持久化快照），用于登出/离开页面
 */

/** 仅持久化快照部分（不含当前分析数据） */
interface FloodPersistedSnapshot {
  waterLevel: number
  affectedFacilities: AffectedFacility[]
  totalLoss: number
}

export const useFloodStore = defineStore('flood', () => {
  // ─── UI 控制 ───────────────────────────────────────────────
  const floodActive = ref(false)
  const showFloodArea = ref(false)
  const showFloodPOI = ref(false)

  // ─── 分析数据 ──────────────────────────────────────────────
  const floodStatistics = ref<FloodStatistics | null>(null)
  const floodFeatures = ref<FloodFeature[]>([])
  const floodRiskLevel = ref('无风险')

  // ─── 持久化快照（使用工厂） ─────────────────────────────
  const persisted = createPersistedState<FloodPersistedSnapshot>()

  // ─── 计算属性 ──────────────────────────────────────────────
  const hasAnalysisData = computed(() => floodStatistics.value !== null)

  // ─── 分析控制 ──────────────────────────────────────────────
  function startFloodAnalysis(
    statistics: FloodStatistics,
    features: FloodFeature[],
    riskLevel: string
  ): void {
    floodActive.value = true
    showFloodArea.value = true
    showFloodPOI.value = true
    floodStatistics.value = statistics
    floodFeatures.value = features
    floodRiskLevel.value = riskLevel
  }

  function resetFloodAnalysis(): void {
    floodActive.value = false
    showFloodArea.value = false
    showFloodPOI.value = false
    floodStatistics.value = null
    floodFeatures.value = []
    floodRiskLevel.value = '无风险'
  }

  // ─── 跨页面状态持久化 ──────────────────────────────────────
  /**
   * 保存当前分析状态（用于离开页面前快照）
   * 与 siteSelectionStore 不同：floodStore 在保存快照时
   * 还需同步更新当前分析数据（floodStatistics 等），
   * 因此不能完全委托给工厂，而是用工厂管理快照部分。
   */
  function saveState(payload: FloodSavedState): void {
    if (payload.floodStatistics) {
      floodStatistics.value = payload.floodStatistics
      floodFeatures.value = payload.floodFeatures
      floodRiskLevel.value = payload.floodRiskLevel
    }
    persisted.saveState({
      waterLevel: payload.waterLevel,
      affectedFacilities: payload.affectedFacilities || [],
      totalLoss: payload.totalLoss || 0,
    })
  }

  /**
   * 消费已保存的状态（用于进入页面时恢复）
   * 从工厂读取快照 + 从当前分析数据组合返回
   */
  function consumeState(): FloodConsumedState | null {
    const snapshot = persisted.consumeState()
    if (!snapshot) return null

    return {
      waterLevel: snapshot.waterLevel,
      floodStatistics: floodStatistics.value,
      floodFeatures: floodFeatures.value,
      floodRiskLevel: floodRiskLevel.value,
      affectedFacilities: snapshot.affectedFacilities,
      totalLoss: snapshot.totalLoss,
    }
  }

  /**
   * 彻底重置（UI + 分析数据 + 持久化快照）
   */
  function clearState(): void {
    persisted.clearPersistedState()
    resetFloodAnalysis()
  }

  return {
    // UI 控制
    floodActive,
    showFloodArea,
    showFloodPOI,
    // 分析数据
    floodStatistics,
    floodFeatures,
    floodRiskLevel,
    // 计算属性
    hasAnalysisData,
    // 持久化
    hasPersistedState: persisted.hasPersistedState,
    // 方法
    startFloodAnalysis,
    resetFloodAnalysis,
    saveState,
    consumeState,
    clearState,
  }
})

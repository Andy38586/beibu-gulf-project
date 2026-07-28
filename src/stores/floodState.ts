import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  FloodStatistics,
  FloodFeature,
  AffectedFacility,
  FloodSavedState,
  FloodConsumedState,
} from '@/types/business/base'

/**
 * 浸没分析统一 Store（Setup Store 风格）
 *
 * 职责：
 * - UI 控制（floodActive / showFloodArea / showFloodPOI）
 * - 分析数据（floodStatistics / floodFeatures / floodRiskLevel）
 * - 跨页面状态持久化（saveState / consumeState / clearState）
 *
 * 持久化策略：
 * - saveState 接收完整 FloodSavedState（含 waterLevel/affectedFacilities/totalLoss）
 * - consumeState 一次性返回全部字段，调用方无需跨 store 组合
 * - clearState 彻底重置（UI + 数据 + 持久化快照），用于登出/离开页面
 */
export const useFloodState = defineStore('flood', () => {
  // ─── UI 控制 ───────────────────────────────────────────────
  const floodActive = ref(false)
  const showFloodArea = ref(false)
  const showFloodPOI = ref(false)

  // ─── 分析数据 ──────────────────────────────────────────────
  const floodStatistics = ref<FloodStatistics | null>(null)
  const floodFeatures = ref<FloodFeature[]>([])
  const floodRiskLevel = ref('无风险')

  // ─── 持久化快照（仅 saveState/consumeState 使用） ─────────
  const hasPersistedState = ref(false)
  const persistedWaterLevel = ref(0)
  const persistedAffectedFacilities = ref<AffectedFacility[]>([])
  const persistedTotalLoss = ref(0)

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
   * 接收完整 FloodSavedState，内部持久化全部字段
   */
  function saveState(payload: FloodSavedState): void {
    if (payload.floodStatistics) {
      floodStatistics.value = payload.floodStatistics
      floodFeatures.value = payload.floodFeatures
      floodRiskLevel.value = payload.floodRiskLevel
    }
    persistedWaterLevel.value = payload.waterLevel
    persistedAffectedFacilities.value = payload.affectedFacilities || []
    persistedTotalLoss.value = payload.totalLoss || 0
    hasPersistedState.value = true
  }

  /**
   * 消费已保存的状态（用于进入页面时恢复）
   * 返回 null 表示无已保存状态
   * 一次性消费：调用后清除持久化标志，但保留当前分析数据供页面使用
   */
  function consumeState(): FloodConsumedState | null {
    if (!hasPersistedState.value) return null

    const result: FloodConsumedState = {
      waterLevel: persistedWaterLevel.value,
      floodStatistics: floodStatistics.value,
      floodFeatures: floodFeatures.value,
      floodRiskLevel: floodRiskLevel.value,
      affectedFacilities: persistedAffectedFacilities.value,
      totalLoss: persistedTotalLoss.value,
    }

    hasPersistedState.value = false
    return result
  }

  /**
   * 彻底重置（UI + 分析数据 + 持久化快照）
   * 用于登出/离开页面
   */
  function clearState(): void {
    hasPersistedState.value = false
    persistedWaterLevel.value = 0
    persistedAffectedFacilities.value = []
    persistedTotalLoss.value = 0
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
    hasPersistedState,
    // 方法
    startFloodAnalysis,
    resetFloodAnalysis,
    saveState,
    consumeState,
    clearState,
  }
})

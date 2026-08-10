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
 * - 分析数据（floodStatistics / floodFeatures / floodRiskLevel）
 * - 跨页面状态持久化（saveState / consumeState / clearState）
 * 2026-08-10（面试报告 P0-3）：floodActive/showFloodArea/showFloodPOI 三个布尔
 * 与 selectedProfileId/profileActive 链全库零消费（UI 控制已由图层状态/组件本地
 * ref 承担；剖面选择在 WaterLevelProfilePanel 用本地 ref），已删。
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
  // ─── 分析数据 ──────────────────────────────────────────────
  const floodStatistics = ref<FloodStatistics | null>(null)
  const floodFeatures = ref<FloodFeature[]>([])
  const floodRiskLevel = ref('无风险')

  // ─── 水位控制（P3：并入原 waterLevelStore） ───────────────
  const waterLevel = ref(0)
  // 2026-08-09：*Active 改 computed 派生（原手动 ref + 单向置位是"派生状态镜像"，
  // setter 忘同步即漂移；现在由真实状态自动推导，删 6 处手动赋值）
  const waterLevelActive = computed(() => waterLevel.value > 0)

  // ─── 港口影响（P3：并入原 portImpactStore） ───────────────
  const affectedFacilities = ref<AffectedFacility[]>([])
  const totalLoss = ref(0)
  const portImpactActive = computed(() => affectedFacilities.value.length > 0)

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
    floodStatistics.value = statistics
    floodFeatures.value = features
    floodRiskLevel.value = riskLevel
  }

  function resetFloodAnalysis(): void {
    floodStatistics.value = null
    floodFeatures.value = []
    floodRiskLevel.value = '无风险'
  }

  // ─── 水位控制（P3：原 waterLevelStore） ───────────────────
  // *Active 由 computed 派生（waterLevel > 0），setter 无需手动同步
  function setWaterLevel(level: number): void {
    waterLevel.value = level
  }

  function resetWaterLevel(): void {
    waterLevel.value = 0
  }

  // ─── 港口影响（P3：原 portImpactStore） ───────────────────
  // *Active 由 computed 派生（affectedFacilities 非空），setter 无需手动同步
  function setPortImpactResult(facilities: AffectedFacility[], loss: number): void {
    affectedFacilities.value = facilities
    totalLoss.value = loss
  }

  function resetPortImpact(): void {
    affectedFacilities.value = []
    totalLoss.value = 0
  }

  // ─── 子状态统一重置（P3：onUnmounted 用——不清 flood 分析，保留跨页面数据） ───
  function resetSubStates(): void {
    resetWaterLevel()
    resetPortImpact()
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
   * 彻底重置（UI + 分析数据 + 子状态 + 持久化快照）
   */
  function clearState(): void {
    persisted.clearPersistedState()
    resetFloodAnalysis()
    resetSubStates()
  }

  return {
    // 分析数据
    floodStatistics,
    floodFeatures,
    floodRiskLevel,
    // 水位控制（P3）
    waterLevel,
    waterLevelActive,
    setWaterLevel,
    resetWaterLevel,
    // 港口影响（P3）
    portImpactActive,
    affectedFacilities,
    totalLoss,
    setPortImpactResult,
    resetPortImpact,
    // 子状态重置（P3）
    resetSubStates,
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

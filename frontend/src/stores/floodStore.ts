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
 * 浸没分析 store（Pinia 全局状态库）：
 * 分析数据（floodStatistics/floodFeatures/floodRiskLevel）+ 跨页面持久化
 * （saveState/consumeState/clearState）。UI 显隐与剖面选择已由图层状态/组件本地 ref 承担，不入 store。
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

  // ─── 水位控制 ──────────────────────────────────────────────
  const waterLevel = ref(0)
  // *Active 由 computed 派生（waterLevel > 0），避免手动同步漂移
  const waterLevelActive = computed(() => waterLevel.value > 0)

  // ─── 港口影响 ─────────────────────────────────────────────
  const affectedFacilities = ref<AffectedFacility[]>([])
  const totalLoss = ref(0)
  const portImpactActive = computed(() => affectedFacilities.value.length > 0)

  // ─── 持久化快照（工厂） ────────────────────────────────
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

  // ─── 水位控制 ──────────────────────────────────────────────
  function setWaterLevel(level: number): void {
    waterLevel.value = level
  }

  function resetWaterLevel(): void {
    waterLevel.value = 0
  }

  // ─── 港口影响 ──────────────────────────────────────────────
  function setPortImpactResult(facilities: AffectedFacility[], loss: number): void {
    affectedFacilities.value = facilities
    totalLoss.value = loss
  }

  function resetPortImpact(): void {
    affectedFacilities.value = []
    totalLoss.value = 0
  }

  // ─── 子状态统一重置（不清分析数据，保留跨页面数据） ──────
  function resetSubStates(): void {
    resetWaterLevel()
    resetPortImpact()
  }

  // ─── 跨页面状态持久化 ──────────────────────────────────────
  /** 保存当前分析状态（离开页面前快照）：与选址不同，此处需同步更新当前分析数据，故快照部分委托工厂 */
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

  /** 消费已保存状态（进入页面恢复）：工厂快照 + 当前分析数据组合返回 */
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

  /** 彻底重置（分析数据 + 子状态 + 持久化快照），用于登出/离开页面 */
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
    // 水位控制
    waterLevel,
    waterLevelActive,
    setWaterLevel,
    resetWaterLevel,
    // 港口影响
    portImpactActive,
    affectedFacilities,
    totalLoss,
    setPortImpactResult,
    resetPortImpact,
    // 子状态重置
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

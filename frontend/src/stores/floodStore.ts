import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type {
  AffectedFacility,
  FloodConsumedState,
  FloodFeature,
  FloodSavedState,
  FloodStatistics,
} from '@/types'

import { createPersistedState } from './factories/createPersistedState'

/**
 * 浸没分析 store（Pinia 全局状态库）：
 * 分析数据（floodStatistics/floodFeatures/floodRiskLevel）+ 跨页面持久化
 * （saveState/consumeState/clearState）。UI 显隐与剖面选择已由图层状态/组件本地 ref 承担，不入 store。
 */

/**
 * 仅持久化快照部分（不含当前分析数据）。
 *
 * `waterLevel` 用契约派生（W03）：原手抄 interface 把字段名/类型重写一遍，
 * `floodStatisticsResponseSchema` 里改名或改型（如 number→string）时这里不报错，
 * 运行时才表现为「恢复后水位是 undefined」。改成 `NonNullable<FloodStatistics['waterLevel']>`
 * 后改名/去掉 optional 都会在 `npm run typecheck` 当场红。
 *
 * 另两个字段**不是**契约字段，保持显式声明（不硬塞成 Pick）：
 * - `affectedFacilities` 是「受影响设施数组」，与契约里的 `affectedFacilityCount` 是
 *   同名不同型（base.ts 的 FloodSavedState 已就此留注）；
 * - `totalLoss` 是港口影响逐项求和的结果，与契约的 `estimatedLoss` 不是同一口径。
 */
type FloodPersistedSnapshot = {
  waterLevel: NonNullable<FloodStatistics['waterLevel']>
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

  // ─── 港口影响 ──────────────────────────────────────────────
  function setPortImpactResult(facilities: AffectedFacility[], loss: number): void {
    affectedFacilities.value = facilities
    totalLoss.value = loss
  }

  // ─── 子状态统一重置（不清分析数据，保留跨页面数据） ──────
  function resetSubStates(): void {
    waterLevel.value = 0
    affectedFacilities.value = []
    totalLoss.value = 0
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
    // 港口影响
    portImpactActive,
    affectedFacilities,
    totalLoss,
    setPortImpactResult,
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

import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * floodState - 浸没分析状态保存/恢复 Store
 *
 * 用途：
 * - P2-2: 跳转到个人中心页时保存当前分析状态，返回时恢复
 * - P3-3: 从个人中心加载历史浸没方案时保存方案数据，跳转后恢复
 *
 * 触发条件：
 * - 仅当从浸没分析页跳转到个人中心（/profile）时保存状态
 * - 跳转到其他路由（首页、其他业务页）时清除状态
 * - 从个人中心返回浸没分析页时恢复状态
 */
export const useFloodStateStore = defineStore('floodState', () => {
  const hasState = ref(false)

  const waterLevel = ref(0)
  const floodStatistics = ref(null)
  const floodFeatures = ref([])
  const floodRiskLevel = ref('无风险')
  const affectedFacilities = ref([])
  const totalLoss = ref(0)

  function saveState(data) {
    waterLevel.value = data.waterLevel
    floodStatistics.value = data.floodStatistics
    floodFeatures.value = data.floodFeatures
    floodRiskLevel.value = data.floodRiskLevel ?? '无风险' // BUGFIX-P2-03: 兼容缺省
    affectedFacilities.value = data.affectedFacilities
    totalLoss.value = data.totalLoss
    hasState.value = true
  }

  function consumeState() {
    if (!hasState.value) return null

    const state = {
      waterLevel: waterLevel.value,
      floodStatistics: floodStatistics.value,
      floodFeatures: floodFeatures.value,
      floodRiskLevel: floodRiskLevel.value,
      affectedFacilities: affectedFacilities.value,
      totalLoss: totalLoss.value,
    }

    clearState()
    return state
  }

  function clearState() {
    hasState.value = false
    waterLevel.value = 0
    floodStatistics.value = null
    floodFeatures.value = []
    floodRiskLevel.value = '无风险'
    affectedFacilities.value = []
    totalLoss.value = 0
  }

  return {
    hasState,
    saveState,
    consumeState,
    clearState,
  }
})

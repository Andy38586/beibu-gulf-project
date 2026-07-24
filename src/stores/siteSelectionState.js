import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * SiteSelectionState Store - 选址分析页状态保存
 *
 * 用途：当用户从选址分析页跳转到个人中心时，保存当前页面状态，
 * 返回后可以恢复状态继续操作（无需重新分析）。
 *
 * 状态保存规则：
 * - 仅当从选址分析页跳转到个人中心（/profile）时保存状态
 * - 跳转到其他路由（首页、其他业务页）时清除状态
 * - 从个人中心返回选址分析页时恢复状态
 */

export const useSiteSelectionStateStore = defineStore('siteSelectionState', () => {
  /** 是否有保存的状态 */
  const hasState = ref(false)

  /** 因子选择状态（SiteFactorPanel 的 typeSettings） */
  const factorSettings = ref(null)

  /** 分析结果小区列表 */
  const matchedXiaoqu = ref([])

  /** 选中的设施类型 */
  const selectedTypes = ref([])

  /** 当前方案ID */
  const currentPlanId = ref(null)

  /** 已保存的小区ID集合 */
  const savedXiaoquIds = ref([])

  /** 设施POI数据（FIX:P1-05） */
  const facilityPoi = ref({})

  /**
   * 保存状态（跳转到个人中心前调用）
   */
  function saveState(data) {
    factorSettings.value = data.factorSettings
    matchedXiaoqu.value = data.matchedXiaoqu
    selectedTypes.value = data.selectedTypes
    currentPlanId.value = data.currentPlanId
    savedXiaoquIds.value = data.savedXiaoquIds
    facilityPoi.value = data.facilityPoi || {} // FIX:P1-05
    hasState.value = true
  }

  /**
   * 获取并清除保存的状态（恢复时调用）
   */
  function consumeState() {
    if (!hasState.value) return null

    const state = {
      factorSettings: factorSettings.value,
      matchedXiaoqu: matchedXiaoqu.value,
      selectedTypes: selectedTypes.value,
      currentPlanId: currentPlanId.value,
      savedXiaoquIds: savedXiaoquIds.value,
      facilityPoi: facilityPoi.value, // FIX:P1-05
    }

    // 清除状态，避免重复恢复
    clearState()
    return state
  }

  /**
   * 清除保存的状态
   */
  function clearState() {
    hasState.value = false
    factorSettings.value = null
    matchedXiaoqu.value = []
    selectedTypes.value = []
    currentPlanId.value = null
    savedXiaoquIds.value = []
    facilityPoi.value = {} // FIX:P1-05
  }

  return {
    hasState,
    saveState,
    consumeState,
    clearState,
  }
})

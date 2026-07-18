/**
 * @typedef {import('@/types/plans').Plan} Plan
 * @typedef {import('@/types/analysis').TypeSetting} TypeSetting
 */

import { ref } from 'vue'
import { useApiRequest } from './useApiRequest'

export function usePlans() {
  const { apiRequest } = useApiRequest()
  /** @type {import('vue').Ref<boolean>} */
  const saving = ref(false)
  /** @type {import('vue').Ref<boolean>} */
  const updating = ref(false)

  async function getPlans() {
    /** @type {Plan[]} */
    return apiRequest('/plans')
  }

  async function createPlan(name, typeSettings) {
    saving.value = true
    try {
      const selectedKeys = Object.entries(typeSettings)
        .filter(([, v]) => v.selected)
        .map(([k]) => k)
      /** @type {Plan} */
      return apiRequest('/plans', {
        method: 'POST',
        body: JSON.stringify({ name, selectedKeys, typeSettings }),
      })
    } finally {
      saving.value = false
    }
  }

  async function deletePlan(id) {
    await apiRequest(`/plans/${id}`, { method: 'DELETE' })
    return null
  }

  async function updatePlan(id, name, typeSettings) {
    updating.value = true
    try {
      const selectedKeys = Object.entries(typeSettings)
        .filter(([, v]) => v.selected)
        .map(([k]) => k)
      /** @type {Plan} */
      return apiRequest(`/plans/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, selectedKeys, typeSettings }),
      })
    } finally {
      updating.value = false
    }
  }

  /**
   * 保存小区到方案
   * @param {string} planId - 方案ID
   * @param {object} xiaoqu - 小区详情（包含 id, name, score, breakdown, selectionCriteria 等）
   */
  async function saveXiaoqu(planId, xiaoqu) {
    return apiRequest(`/plans/${planId}/xiaoqu`, {
      method: 'POST',
      body: JSON.stringify({ xiaoqu }),
    })
  }

  /**
   * 从方案中移除小区
   * @param {string} planId - 方案ID
   * @param {string} xiaoquId - 小区ID
   */
  async function removeXiaoqu(planId, xiaoquId) {
    return apiRequest(`/plans/${planId}/xiaoqu/${xiaoquId}`, {
      method: 'DELETE',
    })
  }

  return { getPlans, createPlan, updatePlan, deletePlan, saveXiaoqu, removeXiaoqu, saving, updating }
}

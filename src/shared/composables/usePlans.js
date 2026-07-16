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

  return { getPlans, createPlan, updatePlan, deletePlan, saving, updating }
}

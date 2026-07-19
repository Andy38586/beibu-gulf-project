import { ref } from 'vue'
import type { Ref } from 'vue'
import type { Plan } from '@/types/plan'
import type { TypeSetting } from '@/types/facility'
import type { SavedXiaoqu } from '@/types/xiaoqu'
import { useApiRequest } from './useApiRequest'

export function usePlans() {
  const { apiRequest, isAuthenticated } = useApiRequest()
  const saving: Ref<boolean> = ref(false)
  const updating: Ref<boolean> = ref(false)
  const loading: Ref<boolean> = ref(false)
  const deleting: Ref<boolean> = ref(false)

  async function getPlans(): Promise<Plan[]> {
    loading.value = true
    try {
      const data = await apiRequest<Plan[]>('/plans')
      // AUDIT-008: 类型验证
      if (!Array.isArray(data)) {
        throw new Error('方案列表数据格式无效')
      }
      return data
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('[usePlans] getPlans failed:', error)
      }
      throw error
    } finally {
      loading.value = false
    }
  }

  async function createPlan(
    name: string,
    typeSettings: Record<string, TypeSetting>,
  ): Promise<Plan> {
    // AUDIT-108: 保存方案前检查登录状态
    if (!isAuthenticated.value) {
      throw new Error('请先登录')
    }
    saving.value = true
    try {
      const selectedKeys = Object.entries(typeSettings)
        .filter(([, v]) => v.selected)
        .map(([k]) => k)
      return apiRequest<Plan>('/plans', {
        method: 'POST',
        body: JSON.stringify({ name, selectedKeys, typeSettings }),
      })
    } finally {
      saving.value = false
    }
  }

  async function deletePlan(id: string): Promise<void> {
    deleting.value = true
    try {
      await apiRequest(`/plans/${id}`, { method: 'DELETE' })
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('[usePlans] deletePlan failed:', error)
      }
      throw error
    } finally {
      deleting.value = false
    }
  }

  async function updatePlan(
    id: string,
    name: string,
    typeSettings: Record<string, TypeSetting>,
  ): Promise<Plan> {
    updating.value = true
    try {
      const selectedKeys = Object.entries(typeSettings)
        .filter(([, v]) => v.selected)
        .map(([k]) => k)
      return apiRequest<Plan>(`/plans/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, selectedKeys, typeSettings }),
      })
    } finally {
      updating.value = false
    }
  }

  async function saveXiaoqu(planId: string, xiaoqu: SavedXiaoqu): Promise<Plan> {
    return apiRequest<Plan>(`/plans/${planId}/xiaoqu`, {
      method: 'POST',
      body: JSON.stringify({ xiaoqu }),
    })
  }

  async function removeXiaoqu(planId: string, xiaoquId: string): Promise<Plan> {
    return apiRequest<Plan>(`/plans/${planId}/xiaoqu/${xiaoquId}`, {
      method: 'DELETE',
    })
  }

  return {
    getPlans,
    createPlan,
    updatePlan,
    deletePlan,
    saveXiaoqu,
    removeXiaoqu,
    saving,
    updating,
    loading,
    deleting,
  }
}

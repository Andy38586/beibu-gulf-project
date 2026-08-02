import type { Ref } from 'vue'
import { ref } from 'vue'

import { handleAuthError, isAuthError } from '@/shared/utils/errorHandler'
import { logger } from '@/shared/utils/logger'
import type { TypeSetting } from '@/types/facility'
import type { Plan } from '@/types/plan'
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
      // 类型验证
      if (!Array.isArray(data)) {
        throw new Error('方案列表数据格式无效')
      }
      return data
    } catch (error) {
      if (isAuthError(error)) {
        await handleAuthError()
        throw error
      }
      if (import.meta.env.DEV) {
        logger.error('[usePlans] getPlans failed:', error)
      }
      throw error
    } finally {
      loading.value = false
    }
  }

  async function createPlan(
    name: string,
    typeSettings: Record<string, TypeSetting>
  ): Promise<Plan> {
    // 保存方案前检查登录状态（软校验：UI 层已拦截，此处兜底）
    if (!isAuthenticated.value) {
      throw new Error('请先登录')
    }
    saving.value = true
    try {
      // flood 方案无 typeSettings，兼容为空对象避免 TypeError
      const settings = typeSettings ?? {}
      const selectedKeys = Object.entries(settings)
        .filter(([, v]) => v.selected)
        .map(([k]) => k)
      // await 使 finally 等待请求完成后再复位，防重复提交生效
      return await apiRequest<Plan>('/plans', {
        method: 'POST',
        body: JSON.stringify({ name, selectedKeys, typeSettings: settings }),
      })
    } catch (error) {
      // 401（Cookie 过期但前端 token 未同步）：统一走软登录提示
      if (isAuthError(error)) {
        await handleAuthError()
        throw error
      }
      if (import.meta.env.DEV) {
        logger.error('[usePlans] createPlan failed:', error)
      }
      throw error
    } finally {
      saving.value = false
    }
  }

  async function deletePlan(id: string): Promise<void> {
    // 删除方案前检查登录状态，与createPlan/updatePlan保持一致
    if (!isAuthenticated.value) {
      throw new Error('请先登录')
    }
    deleting.value = true
    try {
      await apiRequest(`/plans/${id}`, { method: 'DELETE' })
    } catch (error) {
      if (isAuthError(error)) {
        await handleAuthError()
        throw error
      }
      if (import.meta.env.DEV) {
        logger.error('[usePlans] deletePlan failed:', error)
      }
      throw error
    } finally {
      deleting.value = false
    }
  }

  async function updatePlan(
    id: string,
    name: string,
    typeSettings: Record<string, TypeSetting>
  ): Promise<Plan> {
    // 更新方案前检查登录状态，与createPlan保持一致
    if (!isAuthenticated.value) {
      throw new Error('请先登录')
    }
    updating.value = true
    try {
      // flood 方案无 typeSettings，兼容为空对象避免 TypeError
      const settings = typeSettings ?? {}
      const selectedKeys = Object.entries(settings)
        .filter(([, v]) => v.selected)
        .map(([k]) => k)
      // await 使 finally 等待请求完成后再复位，防重复提交生效
      return await apiRequest<Plan>(`/plans/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, selectedKeys, typeSettings: settings }),
      })
    } catch (error) {
      if (isAuthError(error)) {
        await handleAuthError()
        throw error
      }
      if (import.meta.env.DEV) {
        logger.error('[usePlans] updatePlan failed:', error)
      }
      throw error
    } finally {
      updating.value = false
    }
  }

  async function saveXiaoqu(planId: string, xiaoqu: SavedXiaoqu): Promise<Plan> {
    // 保存小区前检查登录状态（软校验：UI 层已拦截，此处兜底）
    if (!isAuthenticated.value) {
      throw new Error('请先登录')
    }
    try {
      return await apiRequest<Plan>(`/plans/${planId}/xiaoqu`, {
        method: 'POST',
        body: JSON.stringify({ xiaoqu }),
      })
    } catch (error) {
      if (isAuthError(error)) {
        await handleAuthError()
        throw error
      }
      if (import.meta.env.DEV) {
        logger.error('[usePlans] saveXiaoqu failed:', error)
      }
      throw error
    }
  }

  async function removeXiaoqu(planId: string, xiaoquId: string): Promise<Plan> {
    try {
      return await apiRequest<Plan>(`/plans/${planId}/xiaoqu/${xiaoquId}`, {
        method: 'DELETE',
      })
    } catch (error) {
      if (isAuthError(error)) {
        await handleAuthError()
        throw error
      }
      if (import.meta.env.DEV) {
        logger.error('[usePlans] removeXiaoqu failed:', error)
      }
      throw error
    }
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

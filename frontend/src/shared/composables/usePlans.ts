import type { Ref } from 'vue'
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import { handleAuthError, isAuthError } from '@/shared/utils/errorHandler'
import { logger } from '@/shared/utils/logger'
import type { TypeSetting } from '@/types/facility'
import type { Plan } from '@/types/plan'
import { planSchema } from '@/types/schemas'
import type { SavedXiaoqu } from '@/types/xiaoqu'

import { useApiRequest } from './useApiRequest'
import { useLatestRequest } from './useLatestRequest'

/** 返回契约（816-专项3-0816-13：显式化，防重构时签名静默漂移） */
export interface UsePlansReturn {
  getPlans: () => Promise<Plan[]>
  createPlan: (name: string, typeSettings: Record<string, TypeSetting>) => Promise<Plan>
  updatePlan: (id: string, name: string, typeSettings: Record<string, TypeSetting>) => Promise<Plan>
  deletePlan: (id: string) => Promise<void>
  saveXiaoqu: (planId: string, xiaoqu: SavedXiaoqu) => Promise<Plan>
  removeXiaoqu: (planId: string, xiaoquId: string) => Promise<Plan>
  cancel: () => void
  saving: Ref<boolean>
  updating: Ref<boolean>
  loading: Ref<boolean>
  deleting: Ref<boolean>
}

export function usePlans(): UsePlansReturn {
  const router = useRouter()
  const { apiRequest, isAuthenticated } = useApiRequest()
  const saving: Ref<boolean> = ref(false)
  const updating: Ref<boolean> = ref(false)
  const loading: Ref<boolean> = ref(false)
  const deleting: Ref<boolean> = ref(false)
  // 读操作竞态守卫用 useLatestRequest；写操作不打断，避免误取消已提交的写请求
  const { createSignal, isLatest, cancel: cancelRequest } = useLatestRequest()

  async function getPlans(): Promise<Plan[]> {
    const signal = createSignal()
    loading.value = true
    try {
      const data = await apiRequest<Plan[]>('/plans', {
        schema: planSchema.array(),
        signal,
      })
      // 类型验证
      if (!Array.isArray(data)) {
        throw new Error('方案列表数据格式无效')
      }
      return data
    } catch (error) {
      if (isAuthError(error)) {
        await handleAuthError(router)
        throw error
      }
      if (import.meta.env.DEV) {
        logger.error('[usePlans] getPlans failed:', error)
      }
      throw error
    } finally {
      if (isLatest(signal)) loading.value = false
    }
  }

  /** 取消在途 getPlans 请求（组件卸载时调用） */
  function cancel(): void {
    cancelRequest()
    loading.value = false
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
        schema: planSchema,
      })
    } catch (error) {
      // 401（Cookie 过期但前端 token 未同步）统一走软登录提示
      if (isAuthError(error)) {
        await handleAuthError(router)
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
    // 与 create/update 一致的登录兜底
    if (!isAuthenticated.value) {
      throw new Error('请先登录')
    }
    deleting.value = true
    try {
      await apiRequest(`/plans/${id}`, { method: 'DELETE' })
    } catch (error) {
      if (isAuthError(error)) {
        await handleAuthError(router)
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
    // 与 create 一致的登录兜底
    if (!isAuthenticated.value) {
      throw new Error('请先登录')
    }
    updating.value = true
    try {
      const settings = typeSettings ?? {}
      const selectedKeys = Object.entries(settings)
        .filter(([, v]) => v.selected)
        .map(([k]) => k)
      return await apiRequest<Plan>(`/plans/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, selectedKeys, typeSettings: settings }),
        schema: planSchema,
      })
    } catch (error) {
      if (isAuthError(error)) {
        await handleAuthError(router)
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
        schema: planSchema,
      })
    } catch (error) {
      if (isAuthError(error)) {
        await handleAuthError(router)
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
        schema: planSchema,
      })
    } catch (error) {
      if (isAuthError(error)) {
        await handleAuthError(router)
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
    cancel,
    saving,
    updating,
    loading,
    deleting,
  }
}

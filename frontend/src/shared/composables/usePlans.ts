import type { Ref } from 'vue'
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import { ENDPOINTS } from '@/shared/constants/api'
import { handleAuthError, isAuthError } from '@/shared/utils/errorHandler'
import { logger } from '@/shared/utils/logger'
import type { TypeSetting } from '@/types/facility'
import type { Plan } from '@/types/plan'
import { planSchema } from '@/types/schemas'

import { useApiRequest } from './useApiRequest'
import { useAuth } from './useAuth'
import { useLatestRequest } from './useLatestRequest'

/** 返回契约显式化，防重构时签名静默漂移 */
export interface UsePlansReturn {
  getPlans: () => Promise<Plan[]>
  updatePlan: (id: string, name: string, typeSettings: Record<string, TypeSetting>) => Promise<Plan>
  deletePlan: (id: string) => Promise<void>
  cancel: () => void
  updating: Ref<boolean>
  loading: Ref<boolean>
  deleting: Ref<boolean>
}

export function usePlans(): UsePlansReturn {
  const router = useRouter()
  // isAuthenticated 取自 useAuth（token+user 双判据）——窗口期/他页登录不再误判未登录
  const { apiRequest } = useApiRequest()
  const { isAuthenticated } = useAuth()
  const updating: Ref<boolean> = ref(false)
  const loading: Ref<boolean> = ref(false)
  const deleting: Ref<boolean> = ref(false)
  // 读操作竞态守卫用 useLatestRequest；写操作不打断，避免误取消已提交的写请求
  const { createSignal, isLatest, cancel: cancelRequest } = useLatestRequest()

  async function getPlans(): Promise<Plan[]> {
    const signal = createSignal()
    loading.value = true
    try {
      const data = await apiRequest<Plan[]>(ENDPOINTS.plans.root, {
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

  async function deletePlan(id: string): Promise<void> {
    // 与 update 一致的登录兜底
    if (!isAuthenticated.value) {
      throw new Error('请先登录')
    }
    deleting.value = true
    try {
      await apiRequest(ENDPOINTS.plans.byId(id), { method: 'DELETE' })
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
      return await apiRequest<Plan>(ENDPOINTS.plans.byId(id), {
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

  return {
    getPlans,
    updatePlan,
    deletePlan,
    cancel,
    updating,
    loading,
    deleting,
  }
}

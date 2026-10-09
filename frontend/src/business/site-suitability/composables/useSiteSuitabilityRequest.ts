/**
 * useSiteSuitabilityRequest — 选址模块请求事务管理器。
 * 复刻 useForecastRequest 模式（同一 useLatestRequest 竞态守卫 + store 事务 ID）：
 * 一次评价任务的请求共享同一事务 ID，新事务自动取消旧请求（AbortController 透传），
 * 事务过期静默丢弃响应；AbortController 由本实例持有，不进 store。
 */
import { computed, type ComputedRef } from 'vue'

import { useLatestRequest } from '@/shared'
import { useSiteSuitabilityStore } from '@/stores'

interface UseSiteSuitabilityRequestReturn {
  isLoading: ComputedRef<boolean>
  startTransaction: () => { transactionId: number; signal: AbortSignal }
  isTransactionValid: (transactionId: number) => boolean
  runInTransaction: <T>(adapterFn: () => Promise<T>, transactionId: number) => Promise<T | null>
  cancelAll: () => void
}

export function useSiteSuitabilityRequest(): UseSiteSuitabilityRequestReturn {
  const state = useSiteSuitabilityStore()
  const { createSignal, cancel: cancelRequest } = useLatestRequest()

  const isLoading: ComputedRef<boolean> = computed(() => state.isRequesting)

  function startTransaction() {
    const transactionId = state.bumpTransactionId()
    const signal = createSignal()
    return { transactionId, signal }
  }

  function isTransactionValid(transactionId: number): boolean {
    return transactionId === state.activeTransactionId
  }

  async function runInTransaction<T>(
    adapterFn: () => Promise<T>,
    transactionId: number
  ): Promise<T | null> {
    if (!isTransactionValid(transactionId)) return null
    try {
      const result = await adapterFn()
      if (!isTransactionValid(transactionId)) return null
      return result
    } catch (e) {
      if (!isTransactionValid(transactionId)) return null
      throw e
    }
  }

  function cancelAll() {
    cancelRequest()
  }

  return { isLoading, startTransaction, isTransactionValid, runInTransaction, cancelAll }
}

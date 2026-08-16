/**
 * useForecastRequest — 预测模块请求事务管理器：一次预测任务的三个请求共享同一事务 ID，
 * 新事务自动取消旧请求（AbortController 透传 signal），事务过期时静默丢弃响应。
 * 事务 ID 与 isRequesting 存于 store 跨组件共享，随 store.reset() 一并复位；
 * AbortController 不可序列化、不响应式，由本实例持有
 */
import { computed, type ComputedRef } from 'vue'

import { ApiError, ErrorCode, useLatestRequest } from '@/shared'
import { useForecastStore } from '@/stores'

/** 返回契约（816-专项3-0816-13：显式化，防重构时签名静默漂移） */
export interface UseForecastRequestReturn {
  isLoading: ComputedRef<boolean>
  startTransaction: () => { transactionId: number; signal: AbortSignal }
  isTransactionValid: (transactionId: number) => boolean
  runInTransaction: <T>(adapterFn: () => Promise<T>, transactionId: number) => Promise<T | null>
  cancelAll: () => void
}

export function useForecastRequest(): UseForecastRequestReturn {
  const forecastState = useForecastStore()
  // 竞态守卫统一走 useLatestRequest；AbortController 实例不进 store（不可序列化、不响应式）
  const { createSignal, cancel: cancelRequest } = useLatestRequest()

  // 透传 store 的 isRequesting 作为响应式 isLoading（保留原接口契约）
  const isLoading: ComputedRef<boolean> = computed(() => forecastState.isRequesting)

  /** 状态变化前调用：取消旧事务并生成新事务 ID */
  function startTransaction() {
    // M11/Q3（816 拍板）：事务 ID 推进走 store action，不再直改 state
    const transactionId = forecastState.bumpTransactionId()
    const signal = createSignal()

    return {
      transactionId,
      signal,
    }
  }

  /** 事务是否仍为最新（ID 未过期） */
  function isTransactionValid(transactionId: number): boolean {
    return transactionId === forecastState.activeTransactionId
  }

  /**
   * 在事务上下文中执行请求：调用前/await 后校验事务，过期或已被新事务取消时静默返回 null；
   * 业务错误（如 401）照常抛出由调用方处理
   */
  async function runInTransaction<T>(
    adapterFn: () => Promise<T>,
    transactionId: number
  ): Promise<T | null> {
    if (!isTransactionValid(transactionId)) {
      return null
    }

    try {
      forecastState.setIsRequesting(true)

      const result = await adapterFn()

      // await 后再次检查事务是否仍然有效（可能在 await 期间被取消）
      if (!isTransactionValid(transactionId)) {
        return null
      }

      return result
    } catch (error) {
      // 事务被取消（网络超时或新事务主动 abort）时静默返回 null：
      // 如快速连续触发时旧请求被中止，照常抛出会误弹 toast；仅事务仍有效时的真实错误照常抛出
      if (
        error instanceof ApiError &&
        (error.code === ErrorCode.TIMEOUT || error.code === ErrorCode.REQUEST_FAILED) &&
        !isTransactionValid(transactionId)
      ) {
        return null
      }
      throw error
    } finally {
      if (isTransactionValid(transactionId)) {
        forecastState.setIsRequesting(false)
      }
    }
  }

  /** 取消所有请求（组件卸载时调用） */
  function cancelAll() {
    cancelRequest()
    forecastState.resetTransactionState()
  }

  return {
    isLoading,
    startTransaction,
    isTransactionValid,
    runInTransaction,
    cancelAll,
  }
}

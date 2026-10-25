/**
 * useForecastRequest — 预测模块请求事务管理器：一次预测任务的三个请求共享同一事务 ID，
 * 新事务自动取消旧请求（AbortController 透传 signal），事务过期时静默丢弃响应。
 * 事务 ID 与 isRequesting 存于 store 跨组件共享，随 store.reset() 一并复位；
 * AbortController 不可序列化、不响应式，由本实例持有。
 * 事务骨架（ID 推进 / signal / 有效性 / 取消）走跨域公共 `useTransactionGuard`。
 */
import type { Router } from 'vue-router'

import { ApiError, ErrorCode, handleAuthError, isAuthError, useTransactionGuard } from '@/shared'
import { useForecastStore } from '@/stores'

/**
 * 401 前置守卫：三个 forecast composable 的 catch 尾部（auth → 429 → showError）共用这一入口。
 * 命中则触发跳登录并返回 true，调用方一行 `if (guardForecastAuth(e, router)) return` 收口。
 * 只覆盖「先跳登录再 return」这一用法；需要等待跳转结果的场景仍直接用 handleAuthError。
 */
export function guardForecastAuth(error: unknown, router: Router): boolean {
  if (!isAuthError(error)) return false
  void handleAuthError(router)
  return true
}

/** 返回契约（显式化，防重构时签名静默漂移） */
interface UseForecastRequestReturn {
  startTransaction: () => { transactionId: number; signal: AbortSignal }
  isTransactionValid: (transactionId: number) => boolean
  runInTransaction: <T>(adapterFn: () => Promise<T>, transactionId: number) => Promise<T | null>
  cancelAll: () => void
}

export function useForecastRequest(): UseForecastRequestReturn {
  const forecastState = useForecastStore()
  const { startTransaction, isTransactionValid, cancelRequest } = useTransactionGuard(forecastState)

  /**
   * 在事务上下文中执行请求：调用前/await 后校验事务，过期或已被新事务取消时静默返回 null；
   * 业务错误（如 401）照常抛出由调用方处理。
   *
   * 本域特色（不抽公共）：托管 store.isRequesting；取消判据是特定 ApiError 码
   * （TIMEOUT / REQUEST_FAILED）而非"任何错误"—— 选址域口径不同，见 useSiteSuitabilityRequest。
   */
  async function runInTransaction<T>(
    adapterFn: () => Promise<T>,
    transactionId: number
  ): Promise<T | null> {
    if (!isTransactionValid(transactionId)) return null

    try {
      forecastState.setIsRequesting(true)

      const result = await adapterFn()

      // await 后再次检查事务是否仍然有效（可能在 await 期间被取消）
      if (!isTransactionValid(transactionId)) return null

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
      if (isTransactionValid(transactionId)) forecastState.setIsRequesting(false)
    }
  }

  /** 取消所有请求（组件卸载时调用） */
  function cancelAll() {
    cancelRequest()
    forecastState.resetTransactionState()
  }

  return { startTransaction, isTransactionValid, runInTransaction, cancelAll }
}

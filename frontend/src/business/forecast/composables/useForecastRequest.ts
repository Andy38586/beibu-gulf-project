/**
 * useForecastRequest — 预测模块专用请求事务管理器（实例级 + store 共享）
 * 核心职责：
 * 1. 统一管理请求事务 ID，保证一次预测任务的三个请求（timeseries、comparison、map）共享同一事务
 * 2. 通过 AbortController 取消旧请求（signal 透传给 apiRequest）
 * 3. 检测请求是否过期（事务 ID 不匹配则丢弃）
 * 设计原则（b039 重构后）：
 * - 事务 ID 与 isRequesting 状态迁入 forecastState store，跨组件共享且可被
 * store.reset() 一并复位（登出/路由切换时统一清零，配合批次1 Part 6）
 * - AbortController 不可序列化、不响应式，仍由 useForecastRequest 实例级持有，
 * 通过 startTransaction 返回的 signal 透传给 apiRequest
 * - ForecastPage 与 useForecastLayer 各自调用 useForecastRequest() 拿到独立实例，
 * 但通过共享的 forecastState.activeTransactionId 维持事务一致性
 * - 事务粒度：一次状态变化（indicator/time/confidence）触发一个事务
 * - 新事务自动取消旧事务的未完成请求
 * - 401 由 apiRequest 抛 ApiError(UNAUTHORIZED)，调用方通过 handleAuthError 统一处理
 */
import { computed, type ComputedRef } from 'vue'

import { ApiError, ErrorCode } from '@/shared'
import { useForecastStore } from '@/stores'

export function useForecastRequest() {
  const forecastState = useForecastStore()
  // 实例级 AbortController（不进 store：不可序列化、不响应式）
  let abortController: AbortController | null = null

  // 透传 store 的 isRequesting 作为响应式 isLoading（保留原接口契约）
  const isLoading: ComputedRef<boolean> = computed(() => forecastState.isRequesting)

  /**
   * 开始新事务
   * 调用时机：状态变化前（indicator/time/confidence 改变前）
   * 效果：取消旧事务，生成新事务 ID
   */
  function startTransaction() {
    if (abortController) {
      abortController.abort()
    }

    forecastState.activeTransactionId += 1
    abortController = new AbortController()

    return {
      transactionId: forecastState.activeTransactionId,
      signal: abortController.signal,
    }
  }

  /**
   * 检查事务是否仍然有效
   * @param {number} transactionId - 要检查的事务 ID
   * @returns {boolean}
   */
  function isTransactionValid(transactionId: number): boolean {
    return transactionId === forecastState.activeTransactionId
  }

  /**
   * 在事务上下文中执行 adapter 调用
   * - 调用前/await 后均检查事务有效性，过期则返回 null
   * - 被取消（AbortError → ApiError(TIMEOUT)）且事务已过期时静默返回 null
   * - 401 等业务错误照常抛出，由调用方处理
   * @param adapterFn - 返回 Promise 的 adapter 调用（已绑定 signal）
   * @param transactionId - 事务 ID
   * @returns adapter 返回值；事务过期或被取消时返回 null
   */
  async function runInTransaction<T>(
    adapterFn: () => Promise<T>,
    transactionId: number
  ): Promise<T | null> {
    if (!isTransactionValid(transactionId)) {
      return null
    }

    try {
      forecastState.isRequesting = true

      const result = await adapterFn()

      // await 后再次检查事务是否仍然有效（可能在 await 期间被取消）
      if (!isTransactionValid(transactionId)) {
        return null
      }

      return result
    } catch (error) {
      // 事务被取消时静默返回 null。涵盖两类取消：
      // 1. TIMEOUT —— 本函数内部 setTimeout 触发 abort（网络超时）
      // 2. REQUEST_FAILED('请求已取消') —— 外部/更新的事务通过 startTransaction 主动 abort
      // 例如切页瞬间 doForecastUpdate 被触发多次，后一次 startTransaction 会 abort 掉
      // 前一批在途请求，若照常抛出则会被 showError 弹 toast，属于误报。
      // 仅当「事务已失效」时吞掉，事务仍有效（最新请求）的真实错误照常抛出。
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
        forecastState.isRequesting = false
      }
    }
  }

  /**
   * 取消所有请求
   * 用于组件卸载等场景
   */
  function cancelAll() {
    if (abortController) {
      abortController.abort()
    }
    forecastState.resetTransactionState()
    abortController = null
  }

  return {
    isLoading,
    startTransaction,
    isTransactionValid,
    runInTransaction,
    cancelAll,
  }
}

/**
 * useForecastRequest — 预测模块专用请求事务管理器（单例模式）
 *
 * 核心职责：
 * 1. 统一管理请求事务 ID，保证一次预测任务的三个请求（timeseries、comparison、map）共享同一事务
 * 2. 通过 AbortController 取消旧请求（signal 透传给 forecastAdapter）
 * 3. 检测请求是否过期（事务 ID 不匹配则丢弃）
 *
 * 设计原则：
 * - 模块级单例，确保 ForecastPage 和 useForecastLayer 共享同一事务状态
 * - 业务层通过 forecastAdapter 取数，本模块仅负责事务/取消/过期检查
 * - 事务粒度：一次状态变化（indicator/time/confidence）触发一个事务
 * - 新事务自动取消旧事务的未完成请求
 * - 401 由 apiRequest 抛 ApiError(UNAUTHORIZED)，调用方通过 handleAuthError 统一处理
 */
import { ref } from 'vue'

import { ApiError, ErrorCode } from '@/shared/composables/useApiRequest'

// 模块级单例状态
let currentTransactionId = 0
let currentAbortController: AbortController | null = null
const isLoading = ref(false)

/**
 * 开始新事务
 * 调用时机：状态变化前（indicator/time/confidence 改变前）
 * 效果：取消旧事务，生成新事务 ID
 */
function startTransaction() {
  if (currentAbortController) {
    currentAbortController.abort()
  }

  currentTransactionId++
  currentAbortController = new AbortController()

  return {
    transactionId: currentTransactionId,
    signal: currentAbortController.signal,
  }
}

/**
 * 检查事务是否仍然有效
 * @param {number} transactionId - 要检查的事务 ID
 * @returns {boolean}
 */
function isTransactionValid(transactionId: number) {
  return transactionId === currentTransactionId
}

/**
 * 在事务上下文中执行 adapter 调用
 *
 * - 调用前/await 后均检查事务有效性，过期则返回 null
 * - 被取消（AbortError → ApiError(TIMEOUT)）且事务已过期时静默返回 null
 * - 401 等业务错误照常抛出，由调用方处理
 *
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
    isLoading.value = true

    const result = await adapterFn()

    // await 后再次检查事务是否仍然有效（可能在 await 期间被取消）
    if (!isTransactionValid(transactionId)) {
      return null
    }

    return result
  } catch (error) {
    // 事务被取消时静默返回 null
    if (error instanceof ApiError && error.code === ErrorCode.TIMEOUT) {
      if (!isTransactionValid(transactionId)) return null
    }
    throw error
  } finally {
    if (isTransactionValid(transactionId)) {
      isLoading.value = false
    }
  }
}

/**
 * 获取当前事务信息
 * 用于需要共享事务 ID 的场景（如一次预测任务的三个请求）
 */
function getCurrentTransaction() {
  return {
    transactionId: currentTransactionId,
    signal: currentAbortController?.signal,
  }
}

/**
 * 取消所有请求
 * 用于组件卸载等场景
 */
function cancelAll() {
  if (currentAbortController) {
    currentAbortController.abort()
  }
  currentTransactionId = 0
  currentAbortController = null
  isLoading.value = false
}

export function useForecastRequest() {
  return {
    isLoading,
    startTransaction,
    isTransactionValid,
    runInTransaction,
    getCurrentTransaction,
    cancelAll,
  }
}

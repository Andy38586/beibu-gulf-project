/**
 * useForecastRequest — 预测模块专用请求事务管理器（单例模式）
 *
 * 核心职责：
 * 1. 统一管理请求事务 ID，保证一次预测任务的三个请求（timeseries、comparison、map）共享同一事务
 * 2. 支持 AbortController 取消旧请求（绕过 useApiRequest，直接用 fetch）
 * 3. 检测请求是否过期（事务 ID 不匹配则丢弃）
 *
 * 设计原则：
 * - 模块级单例，确保 ForecastPage 和 useForecastLayer 共享同一事务状态
 * - 绕过 useApiRequest，直接使用 fetch，支持真正的 AbortController 取消
 * - 事务粒度：一次状态变化（indicator/time/confidence）触发一个事务
 * - 新事务自动取消旧事务的未完成请求
 */
import { ref } from 'vue'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

// ==================== 模块级单例状态 ====================
let currentTransactionId = 0
let currentAbortController = null
const isLoading = ref(false)

/**
 * 开始新事务
 * 调用时机：状态变化前（indicator/time/confidence 改变前）
 * 效果：取消旧事务，生成新事务 ID
 */
function startTransaction() {
  // 取消旧事务
  if (currentAbortController) {
    currentAbortController.abort()
  }
  
  // 生成新事务 ID
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
 * @returns {boolean} - 是否有效
 */
function isTransactionValid(transactionId) {
  return transactionId === currentTransactionId
}

/**
 * 执行预测 API 请求（直接使用 fetch，支持真正的 AbortController）
 * @param {string} path - API 路径
 * @param {number} transactionId - 事务 ID
 * @param {AbortSignal} signal - 取消信号
 * @returns {Promise} - API 响应
 */
async function forecastApiRequest(path, transactionId, signal) {
  // 如果事务已过期，直接返回 null
  if (!isTransactionValid(transactionId)) {
    return null
  }
  
  try {
    isLoading.value = true
    
    // 直接使用 fetch，传入 signal 实现真正的请求取消
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      signal, // 传入外部的 AbortSignal
    })
    
    const data = await res.json().catch(() => ({}))
    
    // 再次检查事务是否仍然有效（可能在 await 期间被取消）
    if (!isTransactionValid(transactionId)) {
      return null
    }
    
    // 处理 401 未授权
    if (res.status === 401) {
      const router = (await import('@/router')).default
      if (router.currentRoute.value.path !== '/') {
        router.push('/')
      }
      throw new Error('登录已过期，请重新登录')
    }
    
    // 处理其他错误
    if (!res.ok) {
      throw new Error(data.error || `请求失败 HTTP ${res.status}`)
    }
    
    return data
  } catch (error) {
    // 如果是取消错误，返回 null
    if (error.name === 'AbortError') {
      return null
    }
    
    // 其他错误向上抛出
    throw error
  } finally {
    // 只有当事务仍然有效时才更新 loading 状态
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

/**
 * 导出单例接口
 */
export function useForecastRequest() {
  return {
    isLoading,
    startTransaction,
    isTransactionValid,
    forecastApiRequest,
    getCurrentTransaction,
    cancelAll,
  }
}

/**
 * 统一错误处理
 *
 * 集中管理错误出口，替换分散的 ElMessage.error / console.error。
 * 后续可接入 Sentry / 日志服务 / 错误上报。
 */

import type { Router } from 'vue-router'

import { logger } from './logger'

/**
 * 统一的用户错误提示
 * @param {*} error - 错误信息（string | Error | unknown，catch 块的 e 为 unknown）
 * @param {object} [options]
 * @param {string} [options.fallback] - 无法提取信息时的兜底文案
 * @param {boolean} [options.silent] - 静默模式（仅 console，不弹窗）
 */
export function showError(
  error: unknown,
  options: { fallback?: string; silent?: boolean } = {}
): void {
  const { fallback = '操作失败，请稍后重试', silent = false } = options

  let message: string = fallback

  if (typeof error === 'string') {
    message = error
  } else if (error instanceof Error) {
    // 过滤 AbortError（用户主动取消，不需要提示）
    if (error.name === 'AbortError') return
    message = error.message || fallback
  } else if (error && typeof error === 'object' && (error as { message?: unknown }).message) {
    message = (error as { message: string }).message
  }

  if (import.meta.env.DEV) {
    logger.error('[ErrorHandler]', error)
  }

  if (!silent) {
    ElMessage.error(message)
  }
}

/**
 * 包装异步操作，自动处理错误
 * @param {Promise} promise - 异步操作
 * @param {string} [fallback] - 错误兜底文案
 * @returns {Promise} - 包装后的 Promise
 */
export async function handleAsync<T>(promise: Promise<T>, fallback?: string): Promise<T> {
  try {
    return await promise
  } catch (error) {
    showError(error, { fallback })
    throw error
  }
}

/**
 * 统一的 401 认证失效处理
 *
 * 所有请求层（useApiRequest / useForecastRequest）在 401 时不主动 redirect，
 * 由调用方识别 401 后调用此函数，统一执行：清理认证状态 + 跳转首页 + 弹登录面板。
 *
 * z044: router 改为必选参数（调用方通过 useRouter() 传入），移除动态 import('@/router')
 * 兜底——动态 import 是 errorHandler→router→business→errorHandler 循环链的根源。
 * useAuth 仍保留动态 import（避免 useAuth→errorHandler 的静态循环，useAuth 内部调用
 * showError）。
 *
 * @param {Router} router - vue-router 实例（调用方通过 useRouter() 传入）
 */
export async function handleAuthError(router: Router): Promise<void> {
  const { useAuth } = await import('@/shared/composables/useAuth')
  const auth = useAuth()
  await auth.logout()

  if (router.currentRoute.value.path !== '/') {
    router.push({ path: '/', query: { showLogin: '1' } })
  }
}

/**
 * 判断错误是否为 401 认证失效
 * @param {unknown} error
 * @returns {boolean}
 */
export function isAuthError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof Error) {
    return (
      (error as Error & { code?: string }).code === 'UNAUTHORIZED' ||
      error.message.includes('请先登录')
    )
  }
  return false
}

/**
 * 统一的警告提示（非阻塞）
 */
export function showWarning(message: string): void {
  if (import.meta.env.DEV) {
    logger.warn('[ErrorHandler:Warning]', message)
  }
  ElMessage.warning(message)
}

/**
 * 统一的成功提示
 */
export function showSuccess(message: string): void {
  ElMessage.success(message)
}

export default { showError, handleAsync, handleAuthError, isAuthError, showWarning, showSuccess }

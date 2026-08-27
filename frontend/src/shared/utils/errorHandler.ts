/** 统一错误出口：集中管理错误提示，替换分散的 ElMessage.error / console.error，后续可接 Sentry 等上报服务 */

import type { Router } from 'vue-router'

import { ApiError, ErrorCode } from '../composables/useApiRequest'
import { showModal, showToast } from './gcsFeedback'
import { logger } from './logger'

/**
 * 统一错误提示：silent 仅记日志不弹窗；提供 retry 回调时用确认弹窗（带"重试"按钮）替代普通 toast
 */
export function showError(
  error: unknown,
  options: { fallback?: string; silent?: boolean; retry?: () => void } = {}
): void {
  const { fallback = '操作失败，请稍后重试', silent = false, retry } = options

  // 用户主动取消（新请求 abort 旧请求等）→ 静默：被取消请求转为 ApiError(REQUEST_FAILED, '请求已取消')，高频场景必须在此吞掉
  if (
    error instanceof ApiError &&
    error.code === ErrorCode.REQUEST_FAILED &&
    error.message === '请求已取消'
  ) {
    return
  }

  let message: string = fallback

  // 816-专项5并 1-2：消息无害化——堆栈/超长/纯英文技术串不回退直接上屏（原始串仅 DEV 日志可见）
  if (typeof error === 'string') {
    message = sanitizeMessage(error, fallback)
  } else if (error instanceof Error) {
    // 过滤 AbortError（用户主动取消，不需要提示）
    if (error.name === 'AbortError') return
    message = sanitizeMessage(error.message, fallback)
  } else if (error && typeof error === 'object' && (error as { message?: unknown }).message) {
    message = sanitizeMessage(String((error as { message: unknown }).message), fallback)
  }

  if (import.meta.env.DEV) {
    logger.error('[ErrorHandler]', error)
  }

  if (!silent) {
    if (retry) {
      // 有重试回调用确认弹窗替代 toast
      showModal({ message, mode: 'error', onConfirm: retry })
    } else {
      showToast(message, 'error')
    }
  }
}

/** 错误消息无害化（816-专项5并 1-2）：堆栈特征（换行）/超长（>120）/纯英文技术串 → 回退 fallback。
 *  导出供内联错误条（如 PlansPanel .plans-error）复用同一口径 */
export function sanitizeMessage(raw: string, fallback: string): string {
  if (!raw) return fallback
  const trimmed = raw.trim()
  if (trimmed.length > 120) return fallback
  if (trimmed.includes('\n')) return fallback
  // 纯 ASCII 技术串（如 "fetch failed"、路径/异常类名）对中文 UI 无意义 → 回退
  if (/^[\x20-\x7E]+$/.test(trimmed)) return fallback
  return trimmed
}

/**
 * 统一 401 认证失效处理：请求层不主动 redirect，由调用方识别 401 后调用——
 * 清理认证状态 + 落点个人中心未登录态（内嵌登录面板，ProfilePage 渲染），
 * 原页面路径随 redirect 参数带回，登录成功后返回继续操作。
 * router 必选（调用方 useRouter 传入），移除动态 import 兜底避免
 * errorHandler→router→business→errorHandler 循环依赖；useAuth 侧保留动态 import 以打破静态循环。
 */
export async function handleAuthError(router: Router): Promise<void> {
  const { useAuth } = await import('@/shared/composables/useAuth')
  const auth = useAuth()
  await auth.logout()

  showWarning('该操作需要先登录')

  const current = router.currentRoute.value
  // 个人中心未登录态自带登录面板；已在个人中心时不重复跳转（面板就地可见）
  if (current.path !== '/profile') {
    void router.push({ path: '/profile', query: { redirect: current.fullPath } })
  }
}

/** 判断错误是否为 401 认证失效 */
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

/** 统一警告提示（非阻塞） */
export function showWarning(message: string): void {
  if (import.meta.env.DEV) {
    logger.warn('[ErrorHandler:Warning]', message)
  }
  showToast(message, 'warning')
}

export default { showError, handleAuthError, isAuthError, showWarning }

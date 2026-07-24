/**
 * 统一错误处理
 *
 * v1.5 冻结版本：集中管理错误出口，替换分散的 ElMessage.error / console.error
 *
 * 使用方式：
 *   import { showError, handleAsync } from '@/shared/utils/errorHandler'
 *
 *   // 直接显示
 *   showError('加载失败')
 *   showError(new Error('网络异常'))
 *
 *   // 包装异步操作
 *   await handleAsync(fetchData(), '数据加载失败')
 *
 * 影响范围：低。只替换错误展示出口，不修改业务逻辑。
 * 后续扩展：可接入 Sentry / 日志服务 / 错误上报。
 */

import { ElMessage } from 'element-plus'

/**
 * 统一的用户错误提示
 * @param {string|Error} error - 错误信息或 Error 对象
 * @param {object} [options]
 * @param {string} [options.fallback] - 无法提取信息时的兜底文案
 * @param {boolean} [options.silent] - 静默模式（仅 console，不弹窗）
 */
export function showError(error, options = {}) {
  const { fallback = '操作失败，请稍后重试', silent = false } = options

  let message = fallback

  if (typeof error === 'string') {
    message = error
  } else if (error instanceof Error) {
    // 过滤 AbortError（用户主动取消，不需要提示）
    if (error.name === 'AbortError') return
    message = error.message || fallback
  } else if (error && typeof error === 'object' && error.message) {
    message = error.message
  }

  // 开发环境输出详细信息
  if (import.meta.env.DEV) {
    console.error('[ErrorHandler]', error)
  }

  // 用户提示
  if (!silent) {
    ElMessage.error(message)
  }
}

/**
 * 包装异步操作，自动处理错误
 * @param {Promise} promise - 异步操作
 * @param {string} [fallback] - 错误兜底文案
 * @returns {Promise} - 包装后的 Promise
 *
 * @example
 *   const data = await handleAsync(fetch('/api/data'), '数据加载失败')
 */
export async function handleAsync(promise, fallback) {
  try {
    return await promise
  } catch (error) {
    showError(error, { fallback })
    throw error // 仍然抛出，让业务层自行决定是否继续
  }
}

/**
 * 统一的警告提示（非阻塞）
 */
export function showWarning(message) {
  if (import.meta.env.DEV) {
    console.warn('[ErrorHandler:Warning]', message)
  }
  ElMessage.warning(message)
}

/**
 * 统一的成功提示
 */
export function showSuccess(message) {
  ElMessage.success(message)
}

export default { showError, handleAsync, showWarning, showSuccess }

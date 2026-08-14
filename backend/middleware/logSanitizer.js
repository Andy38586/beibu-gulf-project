/**
 * 请求日志脱敏中间件（仅打日志、不修改请求）。
 * password / token / secret / authorization / cookie 等敏感字段在输出前打码，
 * 防止未来请求日志泄漏凭据。
 */

const SENSITIVE_KEYS = ['password', 'token', 'secret', 'authorization', 'cookie', 'phone', 'email', 'idcard', 'id_card', 'mobile']

/**
 * 递归打码敏感字段。
 * @param {unknown} value - 待处理值
 * @param {string} [key=''] - 当前键名（用于匹配敏感字段）
 * @returns {unknown} 打码后的值
 */
export function sanitize(value, key = '') {
  if (SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k))) {
    if (typeof value === 'string') return `${value.slice(0, 2)}***`
    return '***'
  }
  if (Array.isArray(value)) return value.map((v) => sanitize(v))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, k)]))
  }
  return value
}

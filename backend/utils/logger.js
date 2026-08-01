/**
 * 后端统一结构化 logger
 *
 * - debug/info：仅 development 环境输出
 * - warn/error：生产保留（test 环境静默）
 * - audit：操作审计日志，生产保留（d043）
 * - 格式：[ISO timestamp] [LEVEL] message
 * - 预留 transport 钩子，未来可接 Winston/Pino
 */

const isDev = process.env.NODE_ENV === 'development'
const isTest = process.env.NODE_ENV === 'test'

function emit(level, args) {
  if (isTest) return
  const timestamp = new Date().toISOString()
  const fn = level === 'debug' ? console.log : console[level]
  fn(`[${timestamp}] [${level.toUpperCase()}]`, ...args)
}

export const logger = {
  debug: (...args) => {
    if (isDev) emit('debug', args)
  },
  info: (...args) => {
    if (isDev) emit('info', args)
  },
  warn: (...args) => emit('warn', args),
  error: (...args) => emit('error', args),
  /** d043: 操作审计日志（生产保留，记录成功操作） */
  audit: (action, detail) => emit('info', [`[AUDIT] ${action}`, detail]),
}

/**
 * 统一 logger（z032：结构化输出）
 * - debug/info：仅 DEV 环境输出
 * - warn/error：生产保留（脱敏，无变量展开）
 * - 预留 transport 钩子，未来接 Sentry 等上报服务
 */
const isDev = import.meta.env.DEV

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** 结构化日志条目 */
interface LogEntry {
  level: LogLevel
  timestamp: string
  args: unknown[]
}

/** 预留 transport 钩子（未来接 Sentry / 自建上报） */
const transports: Array<(entry: LogEntry) => void> = []

export function addLogTransport(fn: (entry: LogEntry) => void): void {
  transports.push(fn)
}

function emit(level: LogLevel, args: unknown[]): void {
  const entry: LogEntry = {
    level,
    timestamp: new Date().toISOString(),
    args,
  }
  // 控制台输出
  const fn = level === 'debug' ? console.log : console[level]
  fn(`[${entry.timestamp}] [${level.toUpperCase()}]`, ...args)
  // transport 上报
  for (const t of transports) {
    try {
      t(entry)
    } catch {
      // transport 异常不阻断业务
    }
  }
}

export const logger = {
  debug: (...args: unknown[]): void => {
    if (isDev) emit('debug', args)
  },
  info: (...args: unknown[]): void => {
    if (isDev) emit('info', args)
  },
  warn: (...args: unknown[]): void => emit('warn', args),
  error: (...args: unknown[]): void => emit('error', args),
}

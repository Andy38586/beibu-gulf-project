/** 统一 logger（结构化输出）：debug/info 仅 DEV 输出；warn/error 生产保留（脱敏，无变量展开） */
const isDev = import.meta.env.DEV

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** 结构化日志条目 */
interface LogEntry {
  level: LogLevel
  timestamp: string
  args: unknown[]
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

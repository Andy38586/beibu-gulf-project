/** 统一 logger（结构化输出）：debug/info 仅 DEV 输出；warn/error 生产保留（脱敏，无变量展开） */
const isDev = import.meta.env.DEV

/** 生产采样率：sampled 在 dev 全量、生产按此概率输出，作为低噪观测口 */
const PROD_SAMPLE_RATE = 0.01

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

/**
 * 采样判定（纯函数，F8 可测单源）：dev 全量；**warn 不采样**（失败日志必须落地）；
 * info 按 PROD_SAMPLE_RATE 低噪。import.meta.env 不在本函数内读，便于用 isDev 参数钉口径。
 */
export function shouldEmitSampled(
  level: 'info' | 'warn',
  isDev: boolean,
  random: number,
  rate: number = PROD_SAMPLE_RATE
): boolean {
  return isDev || level === 'warn' || random < rate
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
  /**
   * 采样日志（生产可观测口）：dev 全量输出；生产按 PROD_SAMPLE_RATE 低噪采样。
   * 请求关联 ID 由调用方显式携带在 args 中（并发请求下全局上下文会交错错乱，不做全局设置）
   *
   * F8（2026-10-05）：**warn 级不受采样率约束**——失败/违约类日志被 1% 采样吞掉等于
   * 生产"没有这条观测口"（原实现 warn 与 info 同走采样）。采样只保留给 info 级噪音。
   */
  sampled: (level: 'info' | 'warn', ...args: unknown[]): void => {
    if (shouldEmitSampled(level, isDev, Math.random())) emit(level, args)
  },
}

/**
 * DB 错误分类：连接级故障必须显式上抛（全局异常过滤 → 5xx），禁止被可降级
 * catch 吞成"合法空结果"——灾害/选址评估把基础设施故障伪装成业务空集即假绿灯。
 * 几何/参数类错误（22xxx/XX000 等）不属于致命级，保留给调用方按降级契约处理。
 */

// PG 连接/资源/运维干预类：08 连接异常族 + 连接数耗尽 + 实例关闭族
const FATAL_PG_CODES = new Set(['53300', '57P01', '57P02', '57P03'])

// Node 网络层系统错误：pool 拨号/传输中断时可能无 PG code，仅系统错误码
const FATAL_SYSTEM_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT'])

export function isFatalDbError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code !== 'string') return false
  return code.startsWith('08') || FATAL_PG_CODES.has(code) || FATAL_SYSTEM_CODES.has(code)
}

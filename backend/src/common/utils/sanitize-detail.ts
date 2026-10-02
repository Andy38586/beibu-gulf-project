/**
 * 出错详情净化（日志 sink 与客户端响应 sink 共用一份）。
 *
 * 为什么要有这个 util：BusinessError.message / 底层异常 message 常由**请求输入**拼出
 *（如业务请求体的 JSON 键名、forecast 的 query indicator、pg 的连接串），
 * 直接写日志或回给客户端有两类后果：
 *   · 换行注入——匿名请求即可伪造服务端日志行；
 *   · 无界长文本——express body 上限 100kb，单条日志可达数十 KB。
 * 此前只有 business-error.filter 一处做了净化，task-queue 的两条日志、csp-report 的字段
 * 裁剪、task.service 的公开响应三处各写各的（csp-report 只截断不压平）——同类 sink 漏一处
 * 就等于这条通道没设防，故收口到这里。
 */

/** 默认截断长度（与 csp-report 原口径一致：200 字） */
export const MAX_DETAIL_LEN = 200

/** 压平换行/制表符与首尾空白后按长度截断（非字符串一律 String() 归一） */
export function sanitizeDetail(value: unknown, maxLen: number = MAX_DETAIL_LEN): string {
  const text = typeof value === 'string' ? value : String(value)
  const flat = text.replace(/[\r\n\t]+/g, ' ').trim()
  return flat.length > maxLen ? `${flat.slice(0, maxLen)}…` : flat
}

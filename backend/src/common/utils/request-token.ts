import type { Request } from 'express'

/**
 * 从请求提取认证令牌：cookie 优先、Bearer 头兜底。
 *
 * 两处消费方此前各自手抄这段提取（AuthGuard 拿去验签+查库；task 的 request-owner
 * 只拿去取「不可伪造的稳定标识」，不做存在性/tokenVersion 校验）。任一处漏改就会出现
 * 「同一个请求在两个入口被认成不同身份」——令牌读取顺序的权威源在此，两处都不得再局部提取。
 */
export function extractRequestToken(req: Request): string | undefined {
  const cookieToken = req.cookies?.auth_token
  if (cookieToken) return cookieToken
  const header = req.headers.authorization
  if (header && header.startsWith('Bearer ')) return header.slice(7)
  return undefined
}

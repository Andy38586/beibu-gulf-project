import type { Request } from 'express'

import { verifyToken } from '../../../common/utils/jwt.util'
import { ANONYMOUS_OWNER } from '../types/task'

/**
 * 从请求解析提交者属主（d059）。
 *
 * task 三个端点**免鉴权**（与 flood/route 同口径：纯计算不读用户数据），
 * 所以这里不能挂 AuthGuard（会把匿名用户全挡掉）。做法是「有令牌就认身份，没有就按匿名会话分槽」：
 *   · 令牌有效 → 属主 = JWT 里的用户 id（取代/取消/查询按它分槽与鉴权）；
 *   · 无令牌 / 令牌无效，但带合法 `x-task-client` → 属主 = `anon:<会话 id>`；
 *   · 两者都无 → ANONYMOUS_OWNER（历史共享槽，见下）。
 *
 * 🔴 为什么要匿名会话 id（2026-09-23 复判补）：d059 只修到一半——三个端点免鉴权（controller
 * 上确实没有 @UseGuards），所有匿名请求都落到同一个 ANONYMOUS_OWNER ⇒「任何人可取消任何人」
 * 只是收窄成「登录用户之间不可，匿名池内仍可」，而 /task 本身就是公开端点。
 * 会话 id 由前端每标签页生成（16–64 位 URL 安全随机串，crypto.randomUUID 去连字符）并随
 * 请求带上；属主判定只认**不可猜测**的 id，故伪造他人会话需先拿到该字符串本身。
 * 未带该头的旧客户端仍共享 ANONYMOUS_OWNER（公开端点语义不变），属已知残留：只影响
 * 「都不带头的客户端彼此之间」，不影响带头客户端与登录用户。
 *
 * 令牌读取顺序与 AuthGuard 逐字一致（cookie 优先、Bearer 兜底），但**不做**用户存在性与
 * tokenVersion 校验——那需要查库，而这里只需要「不可伪造的稳定标识」；验签已保证这一点
 *（伪造/过期一律落到匿名，不会冒充他人属主）。
 */
export const TASK_CLIENT_HEADER = 'x-task-client'
/** 匿名属主前缀：与 JWT 用户 id 分命名空间，避免与真实用户 id 撞槽 */
export const ANONYMOUS_OWNER_PREFIX = 'anon:'
/** 合法会话 id：16–64 位 URL 安全串（短于此易被穷举，长于此没必要） */
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{16,64}$/

export function resolveRequestOwner(req: Request): string {
  let token = req.cookies?.auth_token
  if (!token) {
    const header = req.headers.authorization
    if (header && header.startsWith('Bearer ')) {
      token = header.slice(7)
    }
  }
  const fromToken = token ? verifyToken(token)?.id : undefined
  if (fromToken) return fromToken

  const raw = req.headers[TASK_CLIENT_HEADER]
  const clientId = Array.isArray(raw) ? raw[0] : raw
  if (typeof clientId === 'string' && CLIENT_ID_RE.test(clientId)) {
    return `${ANONYMOUS_OWNER_PREFIX}${clientId}`
  }
  return ANONYMOUS_OWNER
}

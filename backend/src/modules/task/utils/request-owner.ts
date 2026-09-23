import type { Request } from 'express'

import { verifyToken } from '../../../common/utils/jwt.util'
import { ANONYMOUS_OWNER } from '../types/task'

/**
 * 从请求解析提交者属主（d059）。
 *
 * task 三个端点**免鉴权**（与 flood/route/site-analysis 同口径：纯计算不读用户数据），
 * 所以这里不能挂 AuthGuard（会把匿名用户全挡掉）。做法是「有令牌就认身份，没有就归匿名」：
 *   · 令牌有效 → 属主 = JWT 里的用户 id（取代/取消/查询按它分槽与鉴权）；
 *   · 无令牌 / 令牌无效或过期 → ANONYMOUS_OWNER（公开端点语义不变，只是匿名侧同槽）。
 *
 * 令牌读取顺序与 AuthGuard 逐字一致（cookie 优先、Bearer 兜底），但**不做**用户存在性与
 * tokenVersion 校验——那需要查库，而这里只需要「不可伪造的稳定标识」；验签已保证这一点
 *（伪造/过期一律落到匿名，不会冒充他人属主）。
 */
export function resolveRequestOwner(req: Request): string {
  let token = req.cookies?.auth_token
  if (!token) {
    const header = req.headers.authorization
    if (header && header.startsWith('Bearer ')) {
      token = header.slice(7)
    }
  }
  if (!token) return ANONYMOUS_OWNER
  return verifyToken(token)?.id ?? ANONYMOUS_OWNER
}

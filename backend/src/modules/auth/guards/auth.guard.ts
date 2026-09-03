import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import type { Request } from 'express'

import { BusinessError, ErrorCode } from '../../../common/errors/business-error'
import { verifyToken } from '../../../common/utils/jwt.util'
import { UsersRepository } from '../repositories/users.repository'

// 认证守卫：对齐老 Express middleware/auth.js——
// cookie 优先 / Bearer fallback；验签 + 用户存在性 + tokenVersion 三重校验；
// 401 三文案与信封形状 { code: 401001, error, data: null } 逐字节一致
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly usersRepository: UsersRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>()

    let token = req.cookies?.auth_token
    if (!token) {
      const header = req.headers.authorization
      if (header && header.startsWith('Bearer ')) {
        token = header.slice(7)
      }
    }

    if (!token) {
      throw new BusinessError(ErrorCode.UNAUTHORIZED, '未提供认证令牌')
    }

    const decoded = verifyToken(token)
    if (!decoded) {
      throw new BusinessError(ErrorCode.UNAUTHORIZED, '认证令牌无效或已过期')
    }

    const user = await this.usersRepository.findById(decoded.id)
    if (!user) {
      throw new BusinessError(ErrorCode.UNAUTHORIZED, '认证令牌无效或已过期')
    }
    if ((user.token_version ?? 0) !== (decoded.tokenVersion ?? 0)) {
      throw new BusinessError(ErrorCode.UNAUTHORIZED, '令牌已失效，请重新登录')
    }

    // 与 Express 对齐：req.user 只带 id/username（me 端点直接透传）
    ;(req as Request & { user?: { id: string; username: string } }).user = {
      id: user.id,
      username: user.username,
    }
    return true
  }
}

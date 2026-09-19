import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import type { Request } from 'express'

import { BusinessError, ErrorCode } from '../../../common/errors/business-error'
import { verifyToken } from '../../../common/utils/jwt.util'
import { UsersRepository } from '../repositories/users.repository'

/**
 * 认证用户的对外视图（`GET /auth/me` 直接透传本类型）。
 *
 * 🔴 2026-09-19 修复（P0）：此前本视图只有 `id`/`username`，而前端 `userSchema`
 * 要求 `createdAt` 必填 ⇒ `/auth/me` 的 200 响应过不了 zod 校验 ⇒
 * 带有效 Cookie 刷新页面即被登出（登录态无法跨刷新保持）。
 * 收口做法：视图字段集必须 ⊇ 前端消费侧的必填字段集。
 *
 * `created_at` 列当前可为空（`db-schema.sql` 历史遗留），故如实标注 nullable；
 * 新建用户由 `UsersRepository.create()` 保证有值。
 */
export interface AuthUserView {
  id: string
  username: string
  createdAt: string | null
}

/** 经 AuthGuard 处理后的请求：`user` 保证存在（端点内无需判空） */
export type AuthenticatedRequest = Request & { user: AuthUserView }

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

    // 视图字段集与前端 userSchema 的必填字段对齐（createdAt 见 AuthUserView 注释）
    ;(req as Partial<AuthenticatedRequest>).user = {
      id: user.id,
      username: user.username,
      createdAt: user.created_at,
    }
    return true
  }
}

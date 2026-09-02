import { Injectable, Logger } from '@nestjs/common'
import bcrypt from 'bcryptjs'

import { BusinessError, ErrorCode } from '../../../common/errors/business-error'
import { generateToken, verifyToken } from '../../../common/utils/jwt.util'
import { UsersRepository } from '../repositories/users.repository'

const BCRYPT_ROUNDS = 10

// 响应用户视图：键名 camelCase（createdAt/tokenVersion）对齐 Express 响应体，
// 不外泄 password（敏感字段不出边界）
export interface RegisterUserView {
  id: string
  username: string
  createdAt: string | null
  tokenVersion: number
}

export interface LoginUserView {
  id: string
  username: string
  createdAt: string | null
}

// 历史转义密码兼容（与 Express escapeHtmlLegacy / 前端旧版 escapePassword 规则一致）
function escapeHtmlLegacy(str: string): string {
  const escapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }
  return str.replace(/[&<>"']/g, (char) => escapeMap[char])
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(private readonly usersRepository: UsersRepository) {}

  async register(dto: { username: string; password: string }): Promise<{
    user: RegisterUserView
    token: string
  }> {
    // 查重前置：命中即 409，不做无谓 bcrypt 开销（对齐 Express register 顺序）；
    // 并发窗口由 users.username 唯一约束兜底（repository create 内映射 409001）
    const exists = await this.usersRepository.findByUsername(dto.username)
    if (exists) {
      throw new BusinessError(ErrorCode.DUPLICATE_USERNAME, '用户名已存在')
    }
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS)
    const user = await this.usersRepository.create(dto.username, passwordHash)
    const token = generateToken({ id: user.id, username: user.username })
    this.logger.log(`REGISTER user=${user.id}`)
    return {
      user: {
        id: user.id,
        username: user.username,
        createdAt: user.created_at,
        tokenVersion: user.token_version,
      },
      token,
    }
  }

  async login(dto: { username: string; password: string }): Promise<{
    user: LoginUserView
    token: string
  }> {
    const user = await this.usersRepository.findByUsername(dto.username)
    if (!user) {
      // 账号不存在与密码错误细分返回（前端按 bizCode 分语义提示：401002 引导注册）
      throw new BusinessError(ErrorCode.USER_NOT_FOUND)
    }
    // 双通道比对 + 静默迁移（对齐 Express login）；占位密码（迁移数据 'v3-migrated'
    // 非 bcrypt 哈希）compare 恒 false → 落 401003 401，即占位账号登录语义
    let valid = await this.compareSafe(dto.password, user.password)
    if (!valid) {
      const legacy = escapeHtmlLegacy(dto.password)
      if (legacy !== dto.password && (await this.compareSafe(legacy, user.password))) {
        valid = true
        // 静默迁移：用原始密码重哈希，下次登录走正常通道
        const rehashed = await bcrypt.hash(dto.password, BCRYPT_ROUNDS)
        await this.usersRepository.updatePassword(user.id, rehashed)
      }
    }
    if (!valid) {
      throw new BusinessError(ErrorCode.WRONG_PASSWORD)
    }
    const token = generateToken({
      id: user.id,
      username: user.username,
      tokenVersion: user.token_version ?? 0,
    })
    this.logger.log(`LOGIN user=${user.id}`)
    return {
      user: { id: user.id, username: user.username, createdAt: user.created_at },
      token,
    }
  }

  // 吊销令牌：验签通过才自增 tokenVersion——伪造/过期 token 不影响登出流程，
  // 但不吊销任何用户（对齐 Express logout 的 verify-before-revoke，防伪造 payload
  // 批量吊销他人令牌的 DoS）；DB 异常吞掉不影响登出响应（对齐 Express catch-all）
  async logout(token: string | undefined): Promise<void> {
    if (!token) return
    const decoded = verifyToken(token)
    if (!decoded?.id) return
    try {
      await this.usersRepository.incrementTokenVersion(decoded.id)
    } catch (err) {
      this.logger.warn(`LOGOUT revoke failed, cookie 已清除: ${String(err)}`)
    }
  }

  // bcrypt 对畸形哈希（如迁移占位密码）可能抛错：统一按"不匹配"处理，
  // 保证占位/坏哈希账号登录恒得 401 而非 500
  private async compareSafe(password: string, hash: string): Promise<boolean> {
    try {
      return await bcrypt.compare(password, hash)
    } catch {
      return false
    }
  }
}

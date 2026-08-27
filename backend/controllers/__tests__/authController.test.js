// @vitest-environment node
/**
 * authController.logout 回归测试（P0-3 / B-1）
 * 背景：原 logout 用 jwt.decode（仅 base64 解码，不验签）直接吊销 tokenVersion，
 * 攻击者可用伪造 token 让任意合法用户 tokenVersion 自增 → 合法用户被强制登出（DoS）。
 * 修复（SEC-007）：改用 jwt.verify 验签，伪造/过期 token 视为无效、不吊销他人。
 * 本测试锁定（审计编号：P0-3 / B-1）：
 * - 合法 token → updateTokenVersion 被调用一次（tokenVersion+1）
 * - 伪造签名 token → updateTokenVersion 不调用（不吊销合法用户，防 DoS）
 * - 无 token / 过期 token → 仅清 cookie，不吊销
 */
import { beforeEach,describe, expect, it, vi } from 'vitest'

vi.mock('jsonwebtoken', () => ({
  default: { verify: vi.fn(), sign: vi.fn(), decode: vi.fn() },
}))

vi.mock('../../services/userService.js', () => ({
  updateTokenVersion: vi.fn(),
  userExists: vi.fn(),
  findByUsername: vi.fn(),
  createUser: vi.fn(),
  updatePassword: vi.fn(),
}))

vi.mock('../../middleware/auth.js', () => ({
  generateToken: vi.fn(),
}))

vi.mock('../../utils/logger.js', () => ({
  logger: { audit: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}))

import jwt from 'jsonwebtoken'

import { updateTokenVersion } from '../../services/userService.js'
import { logout } from '../authController.js'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.JWT_SECRET = 'test-secret'
})

function createRes() {
  return { clearCookie: vi.fn(), json: vi.fn(), status: vi.fn().mockReturnThis() }
}

describe('authController.logout — 令牌吊销验签（P0-3 / B-1）', () => {
  it('合法 token → updateTokenVersion 被调用一次（tokenVersion+1）', async () => {
    jwt.verify.mockReturnValue({ id: 'user-1', username: 'alice' })
    const req = { cookies: { auth_token: 'valid.jwt.token' }, ip: '127.0.0.1' }
    const res = createRes()
    await logout(req, res)
    expect(updateTokenVersion).toHaveBeenCalledTimes(1)
    expect(updateTokenVersion).toHaveBeenCalledWith('user-1')
    expect(res.clearCookie).toHaveBeenCalledWith('auth_token')
  })

  it('伪造签名 token → updateTokenVersion 不调用（不吊销合法用户，防 DoS）', async () => {
    jwt.verify.mockImplementation(() => {
      throw new Error('invalid signature')
    })
    const req = { cookies: { auth_token: 'forged.token' }, ip: '127.0.0.1' }
    const res = createRes()
    await logout(req, res)
    expect(updateTokenVersion).not.toHaveBeenCalled()
    expect(res.clearCookie).toHaveBeenCalledWith('auth_token')
  })

  it('无 token → 仅清除 cookie，不吊销', async () => {
    const req = { cookies: {}, ip: '127.0.0.1' }
    const res = createRes()
    await logout(req, res)
    expect(updateTokenVersion).not.toHaveBeenCalled()
    expect(res.clearCookie).toHaveBeenCalledWith('auth_token')
  })

  it('过期 token（verify 抛错）→ 不吊销合法用户', async () => {
    jwt.verify.mockImplementation(() => {
      throw new Error('jwt expired')
    })
    const req = { cookies: { auth_token: 'expired.jwt.token' }, ip: '127.0.0.1' }
    const res = createRes()
    await logout(req, res)
    expect(updateTokenVersion).not.toHaveBeenCalled()
    expect(res.clearCookie).toHaveBeenCalledWith('auth_token')
  })
})

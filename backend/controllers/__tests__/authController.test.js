// @vitest-environment node
/**
 * authController 回归测试
 * ① logout 令牌吊销验签（P0-3 / B-1）：
 *    原 logout 用 jwt.decode（仅 base64 解码，不验签）直接吊销 tokenVersion，
 *    攻击者可用伪造 token 让任意合法用户 tokenVersion 自增 → 合法用户被强制登出（DoS）。
 *    修复（SEC-007）：改用 jwt.verify 验签，伪造/过期 token 视为无效、不吊销他人。
 *    锁定（审计编号：P0-3 / B-1）：
 *    - 合法 token → updateTokenVersion 被调用一次（tokenVersion+1）
 *    - 伪造签名 token → updateTokenVersion 不调用（不吊销合法用户，防 DoS）
 *    - 无 token / 过期 token → 仅清 cookie，不吊销
 * ② login 失败语义细分：账号不存在 → 401002（前端引导注册），密码错误 → 401003（仅报密码错误），
 *    不再归一为笼统的「用户名或密码错误」（前端按 bizCode 分语义 toast 的契约）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { findByUsername, updateTokenVersion } from '../../services/userService.js'
import { login, logout } from '../authController.js'

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

describe('authController.login — 失败语义细分（401002/401003）', () => {
  function createLoginReq(body) {
    return { body, ip: '127.0.0.1' }
  }

  it('缺少用户名或密码 → 400 INVALID_PARAMS，不打数据库', async () => {
    const next = vi.fn()
    await login(createLoginReq({ username: 'tester', password: '' }), createRes(), next)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 400001 }))
    expect(findByUsername).not.toHaveBeenCalled()
  })

  it('账号不存在 → 401002 USER_NOT_FOUND（前端据此引导注册）', async () => {
    findByUsername.mockResolvedValue(null)
    const next = vi.fn()
    await login(createLoginReq({ username: 'ghost', password: 'AnyPass1' }), createRes(), next)
    expect(findByUsername).toHaveBeenCalledWith('ghost')
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ code: 401002, status: 401, message: '账号不存在，请先注册' })
    )
  })

  it('账号存在但密码错误 → 401003 WRONG_PASSWORD（不再归一为「用户名或密码错误」）', async () => {
    // bcrypt.compare 对不匹配的哈希返回 false；密码无转义特殊字符 → 不触发旧版回退通道
    findByUsername.mockResolvedValue({
      id: 'user-1',
      username: 'tester',
      password: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
    })
    const next = vi.fn()
    await login(createLoginReq({ username: 'tester', password: 'WrongPass1' }), createRes(), next)
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ code: 401003, status: 401, message: '密码错误' })
    )
  })
})

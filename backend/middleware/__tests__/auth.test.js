import jwt from 'jsonwebtoken'
import { beforeEach,describe, expect, it, vi } from 'vitest'

// auth.js 在模块加载时读取 process.env.JWT_SECRET，缺失即抛错。
// 必须在 import 之前置好（Vitest 不会自动加载项目 .env）。
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-secret-for-tokenversion-at-least-32-chars!'
}

// 隔离 userService，避免真实读写 users.json；auth.js 通过它做 tokenVersion 校验
vi.mock('../../services/userService.js', () => ({
  findById: vi.fn(),
  updateTokenVersion: vi.fn(),
}))

import * as userService from '../../services/userService.js'

// 动态 import：确保上面的 JWT_SECRET 已就位后再加载 auth.js
const { authenticate, generateToken } = await import('../auth.js')
const authController = await import('../../controllers/authController.js')

function makeRes() {
  const res = {}
  res.status = vi.fn(() => res)
  res.json = vi.fn(() => res)
  res.cookie = vi.fn(() => res)
  res.clearCookie = vi.fn(() => res)
  return res
}

describe('auth 中间件 — tokenVersion 吊销（阶段六 6.5）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('tokenVersion 匹配时放行并设置 req.user', async () => {
    const user = { id: 'u1', username: 'alice', tokenVersion: 2 }
    const token = generateToken(user)
    userService.findById.mockResolvedValue(user)
    const req = { cookies: { auth_token: token } }
    const res = makeRes()
    const next = vi.fn()
    await authenticate(req, res, next)
    expect(next).toHaveBeenCalledOnce()
    expect(req.user).toEqual({ id: 'u1', username: 'alice' })
  })

  it('tokenVersion 不匹配（已吊销）时返回 401', async () => {
    const user = { id: 'u1', username: 'alice', tokenVersion: 5 }
    const token = generateToken({ id: 'u1', username: 'alice', tokenVersion: 2 })
    userService.findById.mockResolvedValue(user)
    const req = { cookies: { auth_token: token } }
    const res = makeRes()
    const next = vi.fn()
    await authenticate(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('用户不存在时返回 401', async () => {
    const token = generateToken({ id: 'ghost', username: 'x', tokenVersion: 0 })
    userService.findById.mockResolvedValue(null)
    const req = { cookies: { auth_token: token } }
    const res = makeRes()
    const next = vi.fn()
    await authenticate(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('缺少 token 时返回 401', async () => {
    const req = { cookies: {}, headers: {} }
    const res = makeRes()
    const next = vi.fn()
    await authenticate(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('generateToken 写入 tokenVersion', () => {
    const token = generateToken({ id: 'u1', username: 'alice', tokenVersion: 7 })
    const decoded = jwt.decode(token)
    expect(decoded.tokenVersion).toBe(7)
  })
})

describe('authController.logout — 令牌吊销（阶段六 6.5）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('logout 解码 cookie 并自增 tokenVersion', async () => {
    const token = generateToken({ id: 'u1', username: 'alice', tokenVersion: 2 })
    userService.updateTokenVersion.mockResolvedValue(3)
    const req = { cookies: { auth_token: token } }
    const res = makeRes()
    await authController.logout(req, res)
    expect(userService.updateTokenVersion).toHaveBeenCalledWith('u1')
    expect(res.clearCookie).toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ code: 200, data: { message: '登出成功' } })
  })
})

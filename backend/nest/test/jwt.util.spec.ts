import { beforeEach, describe, expect, it } from 'vitest'

import { generateToken, verifyToken } from '../src/common/utils/jwt.util'

// JWT 工具契约测试：签发/验签行为对齐 Express middleware/auth.js
describe('jwt.util', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'x'.repeat(64)
  })

  it('签发 payload 含 id/username/tokenVersion，可验签还原', () => {
    const token = generateToken({ id: 'u1', username: 'andy', tokenVersion: 2 })
    const payload = verifyToken(token)
    expect(payload).toEqual({ id: 'u1', username: 'andy', tokenVersion: 2 })
  })

  it('tokenVersion 缺省签发为 0', () => {
    const payload = verifyToken(generateToken({ id: 'u1', username: 'andy' }))
    expect(payload?.tokenVersion).toBe(0)
  })

  it('伪造/坏格式 token 验签返回 null（不抛错）', () => {
    expect(verifyToken('not.a.jwt')).toBeNull()
    expect(verifyToken('')).toBeNull()
  })

  it('JWT_SECRET 缺失/长度不足时 fail fast', () => {
    delete process.env.JWT_SECRET
    expect(() => generateToken({ id: 'u1', username: 'a' })).toThrow(/JWT_SECRET 环境变量未设置/)
    process.env.JWT_SECRET = 'short'
    expect(() => generateToken({ id: 'u1', username: 'a' })).toThrow(/长度不足/)
  })
})

import type { ExecutionContext } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { BusinessError } from '../src/common/errors/business-error'
import { AuthGuard } from '../src/modules/auth/guards/auth.guard'

// AuthGuard 五路径测试（mock repository，不触真库）：
// 与老 Express middleware/auth.js 的 401 三文案逐字节对齐
const MOCK_USER = { id: 'u1', username: 'andy', password: 'h', token_version: 0, created_at: null }

function makeContext(token?: string, useHeader = false): ExecutionContext {
  const req: Record<string, unknown> = {
    headers: useHeader && token ? { authorization: `Bearer ${token}` } : {},
    cookies: !useHeader && token ? { auth_token: token } : undefined,
  }
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext
}

function makeGuard(findByIdResult: unknown): {
  guard: AuthGuard
  ctxOf: (t?: string, h?: boolean) => ExecutionContext
} {
  const guard = new AuthGuard({
    findById: async () => findByIdResult,
  } as never)
  return { guard, ctxOf: (t, h) => makeContext(t, h) }
}

describe('AuthGuard（对齐 Express 401 三文案）', () => {
  it('无 cookie 无 header → 401「未提供认证令牌」', async () => {
    const { guard, ctxOf } = makeGuard(MOCK_USER)
    await expect(guard.canActivate(ctxOf())).rejects.toThrow('未提供认证令牌')
  })

  it('Bearer header 可作为 fallback 通道', async () => {
    const { guard, ctxOf } = makeGuard(MOCK_USER)
    process.env.JWT_SECRET = 'x'.repeat(64)
    const { generateToken } = await import('../src/common/utils/jwt.util')
    const token = generateToken({ id: 'u1', username: 'andy', tokenVersion: 0 })
    await expect(guard.canActivate(ctxOf(token, true))).resolves.toBe(true)
  })

  it('坏 token → 401「认证令牌无效或已过期」', async () => {
    const { guard, ctxOf } = makeGuard(MOCK_USER)
    process.env.JWT_SECRET = 'x'.repeat(64)
    await expect(guard.canActivate(ctxOf('bad.token.here'))).rejects.toThrow('认证令牌无效或已过期')
  })

  it('用户不存在 → 401「认证令牌无效或已过期」', async () => {
    const { guard, ctxOf } = makeGuard(null)
    process.env.JWT_SECRET = 'x'.repeat(64)
    const { generateToken } = await import('../src/common/utils/jwt.util')
    const token = generateToken({ id: 'ghost', username: 'g', tokenVersion: 0 })
    const err = await guard.canActivate(ctxOf(token)).catch((e) => e)
    expect(err).toBeInstanceOf(BusinessError)
    expect((err as BusinessError).message).toBe('认证令牌无效或已过期')
    expect((err as BusinessError).bizCode).toBe(401001)
  })

  it('tokenVersion 不匹配（吊销）→ 401「令牌已失效，请重新登录」', async () => {
    const revoked = { ...MOCK_USER, token_version: 5 }
    const { guard, ctxOf } = makeGuard(revoked)
    process.env.JWT_SECRET = 'x'.repeat(64)
    const { generateToken } = await import('../src/common/utils/jwt.util')
    const token = generateToken({ id: 'u1', username: 'andy', tokenVersion: 0 })
    await expect(guard.canActivate(ctxOf(token))).rejects.toThrow('令牌已失效，请重新登录')
  })
})

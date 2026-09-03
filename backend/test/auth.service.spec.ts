import { beforeAll, describe, expect, it, vi } from 'vitest'

import { BusinessError, ErrorCode } from '../src/common/errors/business-error'
import { verifyToken } from '../src/common/utils/jwt.util'
import type { StoredUser } from '../src/modules/auth/repositories/users.repository'
import { AuthService } from '../src/modules/auth/services/auth.service'

// AuthService 单测：仓储 mock，覆盖 Express authController 测试同款五态 +
// 迁移期特有路径（占位密码/静默迁移/吊销）。bcrypt 走真实实现（哈希兼容性属行为）

function makeRepo(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  return {
    findById: vi.fn(),
    findByUsername: vi.fn(),
    create: vi.fn(),
    incrementTokenVersion: vi.fn(),
    updatePassword: vi.fn(),
    ...overrides,
  }
}

function makeService(repo: ReturnType<typeof makeRepo>): AuthService {
  return new AuthService(repo as never)
}

function makeUser(overrides: Partial<StoredUser> = {}): StoredUser {
  return {
    id: 'u-1',
    username: '__t3_user',
    password: '$2a$10$invalidhashinvalidhashinvalidhashinvalidhashinvalidhash',
    token_version: 0,
    created_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function expectBiz(fn: () => Promise<unknown>, code: number, message: string): Promise<void> {
  return fn().then(
    () => expect.unreachable('应抛出 BusinessError'),
    (err) => {
      expect(err).toBeInstanceOf(BusinessError)
      const biz = err as BusinessError
      expect(biz.bizCode).toBe(code)
      expect(biz.message).toBe(message)
    }
  )
}

beforeAll(() => {
  process.env.JWT_SECRET = 'x'.repeat(64)
})

describe('register', () => {
  it('成功 → create 收到 bcrypt 哈希（非明文），token 载荷对齐 Express', async () => {
    const repo = makeRepo({
      findByUsername: vi.fn().mockResolvedValue(null),
      create: vi
        .fn()
        .mockImplementation(async (username: string, hash: string) =>
          makeUser({ username, password: hash, id: 'new-id' })
        ),
    })
    const service = makeService(repo)
    const { user, token } = await service.register({ username: '__t3_new', password: 'Abcdef1' })

    expect(repo.create).toHaveBeenCalledWith('__t3_new', expect.stringMatching(/^\$2[aby]\$/))
    expect(user).toEqual({
      id: 'new-id',
      username: '__t3_new',
      createdAt: '2026-09-01T00:00:00.000Z',
      tokenVersion: 0,
    })
    expect(verifyToken(token)).toMatchObject({
      id: 'new-id',
      username: '__t3_new',
      tokenVersion: 0,
    })
  })

  it('用户名重复 → 409001（create 唯一约束兜底同码）', async () => {
    const repo = makeRepo({ findByUsername: vi.fn().mockResolvedValue(makeUser()) })
    const service = makeService(repo)
    await expectBiz(
      () => service.register({ username: '__t3_user', password: 'Abcdef1' }),
      ErrorCode.DUPLICATE_USERNAME.code,
      '用户名已存在'
    )
    expect(repo.create).not.toHaveBeenCalled()
  })
})

describe('login', () => {
  it('账号不存在 → 401002 账号不存在，请先注册（引导注册细分码）', async () => {
    const repo = makeRepo({ findByUsername: vi.fn().mockResolvedValue(null) })
    const service = makeService(repo)
    await expectBiz(
      () => service.login({ username: '__t3_ghost', password: 'Abcdef1' }),
      ErrorCode.USER_NOT_FOUND.code,
      '账号不存在，请先注册'
    )
  })

  it('密码错误 → 401003 密码错误', async () => {
    const bcrypt = await import('bcryptjs')
    const repo = makeRepo({
      findByUsername: vi
        .fn()
        .mockResolvedValue(makeUser({ password: await bcrypt.hash('RightPass1', 10) })),
    })
    const service = makeService(repo)
    await expectBiz(
      () => service.login({ username: '__t3_user', password: 'WrongPass1' }),
      ErrorCode.WRONG_PASSWORD.code,
      '密码错误'
    )
  })

  it('占位密码账号（迁移数据非 bcrypt 哈希）→ 401003 401，不 500（占位语义）', async () => {
    const repo = makeRepo({
      findByUsername: vi.fn().mockResolvedValue(makeUser({ password: 'v3-migrated' })),
    })
    const service = makeService(repo)
    await expectBiz(
      () => service.login({ username: '__t3_user', password: 'Abcdef1' }),
      ErrorCode.WRONG_PASSWORD.code,
      '密码错误'
    )
  })

  it('登录成功 → 响应视图只含 id/username/createdAt', async () => {
    const bcrypt = await import('bcryptjs')
    const repo = makeRepo({
      findByUsername: vi
        .fn()
        .mockResolvedValue(
          makeUser({ password: await bcrypt.hash('Abcdef1', 10), token_version: 3 })
        ),
    })
    const service = makeService(repo)
    const { user, token } = await service.login({ username: '__t3_user', password: 'Abcdef1' })
    expect(user).toEqual({
      id: 'u-1',
      username: '__t3_user',
      createdAt: '2026-09-01T00:00:00.000Z',
    })
    expect(verifyToken(token)).toMatchObject({ id: 'u-1', tokenVersion: 3 })
  })

  it('历史转义密码通道命中 → 静默重哈希原始密码回写（对齐 Express 静默迁移）', async () => {
    const bcrypt = await import('bcryptjs')
    // 存量哈希是"转义后密码"的哈希（旧版前端 escapePassword 产物）：
    // 原始密码 aB1<x> 经 &<>"' 全集转义 → aB1&lt;x&gt;
    const legacyHash = await bcrypt.hash('aB1&lt;x&gt;', 10)
    const repo = makeRepo({
      findByUsername: vi.fn().mockResolvedValue(makeUser({ password: legacyHash })),
      updatePassword: vi.fn().mockResolvedValue(true),
    })
    const service = makeService(repo)
    const { user } = await service.login({ username: '__t3_user', password: 'aB1<x>' })
    expect(user.id).toBe('u-1')
    // 静默迁移：以原始密码（非转义）重哈希，下次登录走正常通道
    expect(repo.updatePassword).toHaveBeenCalledWith('u-1', expect.stringMatching(/^\$2[aby]\$/))
    const rehash = (repo.updatePassword as ReturnType<typeof vi.fn>).mock.calls[0][1] as string
    expect(await bcrypt.compare('aB1<x>', rehash)).toBe(true)
  })
})

describe('logout', () => {
  it('合法 token → 自增 tokenVersion 吊销', async () => {
    const { generateToken } = await import('../src/common/utils/jwt.util')
    const repo = makeRepo({ incrementTokenVersion: vi.fn().mockResolvedValue(1) })
    const service = makeService(repo)
    const token = generateToken({ id: 'u-1', username: '__t3_user' })
    await service.logout(token)
    expect(repo.incrementTokenVersion).toHaveBeenCalledWith('u-1')
  })

  it('伪造/垃圾 token → 不吊销、不抛错（verify-before-revoke，防伪造 payload 批量吊销）', async () => {
    const repo = makeRepo({ incrementTokenVersion: vi.fn() })
    const service = makeService(repo)
    await service.logout('forged.token.here')
    expect(repo.incrementTokenVersion).not.toHaveBeenCalled()
  })

  it('未带 token → 直接返回（对齐 Express logout 无 cookie 路径）', async () => {
    const repo = makeRepo({ incrementTokenVersion: vi.fn() })
    const service = makeService(repo)
    await expect(service.logout(undefined)).resolves.toBeUndefined()
    expect(repo.incrementTokenVersion).not.toHaveBeenCalled()
  })

  it('吊销时 DB 故障 → 吞错不阻塞登出响应（对齐 Express catch-all）', async () => {
    const { generateToken } = await import('../src/common/utils/jwt.util')
    const repo = makeRepo({
      incrementTokenVersion: vi.fn().mockRejectedValue(new Error('db down')),
    })
    const service = makeService(repo)
    const token = generateToken({ id: 'u-1', username: '__t3_user' })
    await expect(service.logout(token)).resolves.toBeUndefined()
  })
})

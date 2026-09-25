import { describe, expect, it, vi } from 'vitest'

import type { ConfigService } from '../src/infra/config/config.service'
import { AuthController } from '../src/modules/auth/controllers/auth.controller'
import type { AuthService } from '../src/modules/auth/services/auth.service'

/**
 * z054 接线断言：auth cookie 的 `Secure` **取自 `ConfigService.cookieSecure`**，
 * 不再由 `req.secure || x-forwarded-proto` 推定。
 *
 * 为什么必须测接线而非只测 ConfigService：`cookieSecure` 的纯函数用例（config.service.spec）
 * 全绿也不代表 controller 用了它——原缺陷正是「配置对了但 controller 按请求头猜」。
 * 这两条一正一反把「值确实流到 res.cookie 的 options」钉死：
 *   · 开发（cookieSecure=false）⇒ secure:false（若改成 OR 上请求头/硬编码 true ⇒ 红）
 *   · 生产（cookieSecure=true） ⇒ secure:true （若被 AND/硬编码 false ⇒ 红）
 */
function makeRes() {
  const cookie = vi.fn()
  return { res: { cookie, clearCookie: vi.fn(), set: vi.fn() }, cookie }
}

function makeController(cookieSecure: boolean) {
  const svc = {
    login: vi.fn(async () => ({ user: { id: 'u1', username: 'u' }, token: 'tok' })),
    register: vi.fn(async () => ({ user: { id: 'u1', username: 'u' }, token: 'tok' })),
  } as unknown as AuthService
  const config = { cookieSecure } as ConfigService
  return new AuthController(svc, config)
}

describe('auth cookie Secure 接线（z054）', () => {
  it('开发（cookieSecure=false）⇒ Set-Cookie 不含 Secure（不按协议头猜）', async () => {
    const controller = makeController(false)
    const { res, cookie } = makeRes()
    await controller.login({ username: 'u', password: 'p' } as never, res as never)
    expect(cookie).toHaveBeenCalledTimes(1)
    const [name, , options] = cookie.mock.calls[0]
    expect(name).toBe('auth_token')
    expect(options).toMatchObject({ httpOnly: true, secure: false, sameSite: 'strict' })
  })

  it('生产（cookieSecure=true）⇒ Set-Cookie 带 Secure', async () => {
    const controller = makeController(true)
    const { res, cookie } = makeRes()
    await controller.register({ username: 'u', password: 'p' } as never, res as never)
    expect(cookie).toHaveBeenCalledTimes(1)
    expect(cookie.mock.calls[0][2]).toMatchObject({ secure: true })
  })
})

// @vitest-environment jsdom
/**
 * login / register 共用实现（authenticate）的行为判据（D21 批 5 收口防回归）。
 *
 * 收口前两者是两份 30 行逐字复刻；抽公共实现后最易接错的点是
 * 「端点串了」与「错误文案被写死成同一句」。本件把这两点钉成断言：
 *   - register 若被误接到 /auth/login，第二例必红
 *   - actionLabel 若被写死，第三例必红
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const mockApiRequest = vi.hoisted(() => vi.fn())
const mockSetToken = vi.hoisted(() => vi.fn())
const mockClearToken = vi.hoisted(() => vi.fn())

// 仅替换 useApiRequest 的行为侧，保留真实 ApiError/ErrorCode（同 useAuth.authState.test）
vi.mock('@/shared/composables/useApiRequest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/composables/useApiRequest')>()
  return {
    ...actual,
    useApiRequest: () => ({
      apiRequest: mockApiRequest,
      token: ref(''),
      setToken: mockSetToken,
      clearToken: mockClearToken,
    }),
  }
})

/** jsdom 无 Storage 方法：stub 一个 map 实现（同 useAuth.authState.test） */
const localStorageStore = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => localStorageStore.get(key) ?? null,
  setItem: (key: string, value: string) => void localStorageStore.set(key, value),
  removeItem: (key: string) => void localStorageStore.delete(key),
})

const USER = { id: 'u1', username: 'tester', createdAt: '2026-08-29T00:00:00.000Z' }

/** 重置模块单例（user/token 住模块级）后重新导入 */
async function importFreshAuth() {
  vi.resetModules()
  return await import('../useAuth')
}

describe('useAuth.authenticate — login/register 共用实现', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageStore.clear()
  })

  it('login 走 /auth/login 并落地用户态（token 占位 + 用户 + 持久化）', async () => {
    mockApiRequest.mockResolvedValue({ user: USER })
    const { useAuth } = await importFreshAuth()
    const auth = useAuth()

    await expect(auth.login('tester', 'pw')).resolves.toEqual(USER)
    expect(mockApiRequest.mock.calls[0][0]).toBe('/auth/login')
    expect(JSON.parse(mockApiRequest.mock.calls[0][1].body)).toEqual({
      username: 'tester',
      password: 'pw',
    })
    expect(auth.user.value).toEqual(USER)
    expect(mockSetToken).toHaveBeenCalledWith('cookie-auth')
    expect(auth.isAuthenticated.value).toBe(true)
  })

  it('register 走 /auth/register（与 login 不同端点）且落地同一套用户态', async () => {
    mockApiRequest.mockResolvedValue({ user: USER })
    const { useAuth } = await importFreshAuth()
    const auth = useAuth()

    await expect(auth.register('tester', 'pw')).resolves.toEqual(USER)
    expect(mockApiRequest.mock.calls[0][0]).toBe('/auth/register')
    expect(auth.user.value).toEqual(USER)
    expect(mockSetToken).toHaveBeenCalledWith('cookie-auth')
  })

  it('响应无效时两条路径各保留自己的中文文案（actionLabel 未被写死）', async () => {
    mockApiRequest.mockResolvedValue(null)
    const { useAuth } = await importFreshAuth()
    const auth = useAuth()

    await expect(auth.login('t', 'p')).rejects.toThrow('登录响应数据无效')
    await expect(auth.register('t', 'p')).rejects.toThrow('注册响应数据无效')
  })
})

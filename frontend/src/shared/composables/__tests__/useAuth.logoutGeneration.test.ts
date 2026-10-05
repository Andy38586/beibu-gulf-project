// @vitest-environment jsdom
/**
 * 1004-07 登出代次守卫回归：logout 的 await 期间若新登录已完成，旧 finally 不得清场。
 * 修前形态：登出接口慢 + 用户重新登录成功 ⇒ 旧 finally 无条件 clearToken/user=null，
 * 界面回未登录而后端 Cookie 有效（前后端状态分叉）。
 */
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const mockApiRequest = vi.hoisted(() => vi.fn())
const mockSetToken = vi.hoisted(() => vi.fn())
const mockClearToken = vi.hoisted(() => vi.fn())

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

const localStorageStore = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => localStorageStore.get(key) ?? null,
  setItem: (key: string, value: string) => void localStorageStore.set(key, value),
  removeItem: (key: string) => void localStorageStore.delete(key),
})

const USER_A = { id: 'u1', username: 'tester', createdAt: '2026-08-29T00:00:00.000Z' }
const USER_B = { id: 'u2', username: 'other', createdAt: '2026-08-29T00:00:00.000Z' }

describe('useAuth logout 代次守卫（1004-07）', () => {
  it('🔴 logout await 期间新登录完成 ⇒ finally 不得清新会话（删代次守卫即红）', async () => {
    vi.resetModules()
    const { useAuth } = await import('../useAuth')
    const auth = useAuth()

    let releaseLogout: (() => void) | null = null
    mockApiRequest.mockImplementation((path: string) => {
      if (path.includes('logout')) {
        // 挂起登出接口：模拟慢网络窗口
        return new Promise((resolve) => {
          releaseLogout = () => resolve({ ok: true })
        })
      }
      return Promise.resolve({ user: USER_B })
    })
    mockApiRequest.mockResolvedValueOnce({ user: USER_A }) // 第一次 login

    await auth.login('tester', 'pw')
    expect(auth.user.value?.username).toBe('tester')

    const logoutPromise = auth.logout()
    await vi.waitFor(() => expect(releaseLogout).not.toBeNull())

    // await 窗口内：新登录完成（代次 +1）
    await auth.login('other', 'pw2')
    expect(auth.user.value?.username).toBe('other')

    // 放行旧登出：其 finally 不得覆盖新会话
    releaseLogout!()
    await logoutPromise

    expect(auth.user.value?.username).toBe('other')
    expect(auth.isAuthenticated.value).toBe(true)
  })
})

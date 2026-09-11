// @vitest-environment jsdom
/**
 * isAuthenticated 认证态判据单测（审查 M-10/M-9 回归）：
 * 判据 = token 占位 || user 存在（定义上移 useAuth，useApiRequest 不再有第二份判据）。
 * 覆盖：localStorage 临时态窗口期（M-10）、他页登录 storage 同步（M-9）、登出清零。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const mockApiRequest = vi.hoisted(() => vi.fn())
const mockSetToken = vi.hoisted(() => vi.fn())
const mockClearToken = vi.hoisted(() => vi.fn())

// 仅替换 useApiRequest 的行为侧，保留真实 ApiError/ErrorCode（useAuth.restore.test 同款）
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

const STORED_USER = { id: 'u1', username: 'tester', createdAt: '2026-08-29T00:00:00.000Z' }
const USER_STORAGE_KEY = 'beibu-gulf-user'

/** jsdom 环境无 Storage 方法：stub 一个 map 实现（useAuth.restore.test 同款） */
const localStorageStore = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => localStorageStore.get(key) ?? null,
  setItem: (key: string, value: string) => void localStorageStore.set(key, value),
  removeItem: (key: string) => void localStorageStore.delete(key),
})

/** 重置模块单例（user/token 住模块级）后重新导入 */
async function importFreshAuth() {
  vi.resetModules()
  return await import('../useAuth')
}

describe('isAuthenticated — token+user 双判据', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageStore.clear()
  })

  it('无本地态且未登录 → false', async () => {
    const { useAuth } = await importFreshAuth()
    expect(useAuth().isAuthenticated.value).toBe(false)
  })

  it('localStorage 有 user 但 token 空（启动窗口期）→ true（M-10：不再误判未登录）', async () => {
    localStorageStore.set(USER_STORAGE_KEY, JSON.stringify(STORED_USER))
    const { useAuth } = await importFreshAuth()
    const auth = useAuth()
    expect(auth.user.value?.username).toBe('tester')
    expect(auth.isAuthenticated.value).toBe(true)
  })

  it('登录成功（mock /auth/login）→ true；登出后 → false', async () => {
    mockApiRequest.mockResolvedValue({ user: STORED_USER })
    const { useAuth } = await importFreshAuth()
    const auth = useAuth()
    await auth.login('tester', 'pw')
    expect(auth.isAuthenticated.value).toBe(true)
    await auth.logout()
    expect(auth.isAuthenticated.value).toBe(false)
    expect(auth.user.value).toBeNull()
  })

  it('他页登录 storage 同步 → user 就位即认证（M-9：不再因 token 空误判）', async () => {
    const { useAuth, initAuthStorageListener } = await importFreshAuth()
    initAuthStorageListener()
    const auth = useAuth()
    expect(auth.isAuthenticated.value).toBe(false)

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: USER_STORAGE_KEY,
        newValue: JSON.stringify(STORED_USER),
      })
    )
    expect(auth.user.value?.username).toBe('tester')
    expect(auth.isAuthenticated.value).toBe(true)
  })

  it('他页登出 storage 同步（newValue null）→ 清 user，回到未认证', async () => {
    localStorageStore.set(USER_STORAGE_KEY, JSON.stringify(STORED_USER))
    const { useAuth, initAuthStorageListener } = await importFreshAuth()
    initAuthStorageListener()
    const auth = useAuth()
    expect(auth.isAuthenticated.value).toBe(true)

    window.dispatchEvent(new StorageEvent('storage', { key: USER_STORAGE_KEY, newValue: null }))
    expect(auth.user.value).toBeNull()
    expect(mockClearToken).toHaveBeenCalled()
    expect(auth.isAuthenticated.value).toBe(false)
  })
})

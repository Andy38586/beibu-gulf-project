// @vitest-environment jsdom
/**
 * restoreAuth 认证恢复的成因区分单测：
 * 后端不可达（网络/超时/网关 5xx）≠ 未登录——保留 localStorage 临时登录态，
 * Cookie 权威校验顺延到首个真实请求；401 才清登录态。防后端宕机被误报「请先登录」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const mockApiRequest = vi.hoisted(() => vi.fn())
const mockSetToken = vi.hoisted(() => vi.fn())
const mockClearToken = vi.hoisted(() => vi.fn())

// 仅替换 useApiRequest 的行为侧（apiRequest/setToken/clearToken），保留真实 ApiError/ErrorCode
vi.mock('@/shared/composables/useApiRequest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/composables/useApiRequest')>()
  return {
    ...actual,
    useApiRequest: () => ({
      apiRequest: mockApiRequest,
      token: ref(''),
      isAuthenticated: ref(false),
      setToken: mockSetToken,
      clearToken: mockClearToken,
    }),
  }
})

const STORED_USER = { id: 'u1', username: 'tester', createdAt: '2026-08-29T00:00:00.000Z' }

/** jsdom 环境无 Storage 方法（见 useTheme.safeStorage 同款坑）：stub 一个 map 实现 */
const localStorageStore = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => localStorageStore.get(key) ?? null,
  setItem: (key: string, value: string) => void localStorageStore.set(key, value),
  removeItem: (key: string) => void localStorageStore.delete(key),
})

/** 重置模块单例（user/authRestored 住模块级）后重新导入 */
async function importFreshAuth() {
  vi.resetModules()
  return await import('../useAuth')
}

describe('restoreAuth（认证恢复的成因区分）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageStore.clear()
    localStorageStore.set('beibu-gulf-user', JSON.stringify(STORED_USER))
  })

  it('/auth/me 网络失败（后端宕机）→ 保留临时登录态，不误判未登录', async () => {
    const { ApiError, ErrorCode } = await import('@/shared/composables/useApiRequest')
    mockApiRequest.mockRejectedValue(
      new ApiError('网络异常，请检查网络连接', ErrorCode.NETWORK_ERROR)
    )
    const { useAuth } = await importFreshAuth()
    const auth = useAuth()
    const user = await auth.restoreAuth()
    expect(user?.username).toBe('tester')
    expect(auth.user.value?.username).toBe('tester')
    expect(mockSetToken).toHaveBeenCalledWith('restored-from-cache')
    expect(mockClearToken).not.toHaveBeenCalled()
    // localStorage 不被误清
    expect(localStorageStore.get('beibu-gulf-user')).not.toBeNull()
  })

  it('/auth/me 401（Cookie 失效）→ 清除前端登录态', async () => {
    const { ApiError, ErrorCode } = await import('@/shared/composables/useApiRequest')
    mockApiRequest.mockRejectedValue(new ApiError('请先登录', ErrorCode.UNAUTHORIZED))
    const { useAuth } = await importFreshAuth()
    const auth = useAuth()
    const user = await auth.restoreAuth()
    expect(user).toBeNull()
    expect(auth.user.value).toBeNull()
    expect(mockClearToken).toHaveBeenCalled()
    expect(localStorageStore.has('beibu-gulf-user')).toBe(false)
  })

  it('无 localStorage 用户且后端不可达 → 维持未登录（不伪造登录态）', async () => {
    const { ApiError, ErrorCode } = await import('@/shared/composables/useApiRequest')
    localStorageStore.delete('beibu-gulf-user')
    mockApiRequest.mockRejectedValue(
      new ApiError('网络异常，请检查网络连接', ErrorCode.NETWORK_ERROR)
    )
    const { useAuth } = await importFreshAuth()
    const auth = useAuth()
    expect(await auth.restoreAuth()).toBeNull()
    expect(mockSetToken).not.toHaveBeenCalled()
    expect(auth.user.value).toBeNull()
  })
})

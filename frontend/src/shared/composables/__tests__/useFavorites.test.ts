// @vitest-environment jsdom
/**
 * useFavorites 全局收藏单例测试：
 * 登录守卫（未登录 add/remove 抛错）、幂等添加（existed 透传）、登录态驱动的拉取与清空、
 * 未登录收藏意图（pendingFavorite）在登录成功后自动补完。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { Ref } from 'vue'

const mockApiRequest = vi.hoisted(() => vi.fn())
// user ref 在 mock 工厂内创建（vue ref），经 state 容器暴露给测试驱动登录态
const state = vi.hoisted(() => ({ userRef: null as Ref<unknown> | null }))

vi.mock('@/shared/composables/useApiRequest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/composables/useApiRequest')>()
  return {
    ...actual,
    useApiRequest: () => ({
      apiRequest: mockApiRequest,
      token: { value: '' } as never,
      isAuthenticated: { value: false } as never,
      setToken: vi.fn(),
      clearToken: vi.fn(),
    }),
  }
})

vi.mock('@/shared/composables/useAuth', async () => {
  const { ref } = await import('vue')
  const user = ref(null)
  state.userRef = user
  return { useAuth: () => ({ user }) }
})

async function importFreshFavorites() {
  vi.resetModules()
  return await import('../useFavorites')
}

/** 模拟登录成功（写入 user ref；类型仅为测试形状） */
function loginAs(user: unknown): void {
  state.userRef!.value = user
}

function logout(): void {
  if (state.userRef) {
    state.userRef.value = null
  }
}

const TEST_USER = { id: 'u1', username: 'tester', createdAt: '2026-08-29T00:00:00.000Z' }
const input = {
  itemType: 'xiaoqu' as const,
  itemId: 'B1',
  name: '小区A',
  lng: 108.5,
  lat: 21.7,
  snapshot: null,
}
const favoriteRecord = {
  id: 'f1',
  userId: 'u1',
  itemType: 'xiaoqu',
  itemId: 'B1',
  name: '小区A',
  lng: 1,
  lat: 2,
  savedAt: 't',
}

beforeEach(() => {
  // 默认 GET 返回空收藏（未覆盖时 watch 拉取也不至于拿到 undefined）；各用例按需覆盖
  mockApiRequest.mockResolvedValue([])
  logout()
})

describe('useFavorites（全局收藏单例）', () => {
  it('未登录 → add/remove 抛「请先登录」', async () => {
    const { useFavorites } = await importFreshFavorites()
    const favorites = useFavorites()
    await expect(favorites.addFavorite(input)).rejects.toThrow('请先登录')
    await expect(favorites.removeFavorite('xiaoqu', 'B1')).rejects.toThrow('请先登录')
    expect(mockApiRequest).not.toHaveBeenCalled()
  })

  it('登录后 addFavorite → 写入全局列表；isFavorite 按类型全局判定', async () => {
    loginAs(TEST_USER)
    const { useFavorites } = await importFreshFavorites()
    const favorites = useFavorites()
    // 登录触发的拉取（GET /favorites）
    await vi.waitFor(() =>
      expect(mockApiRequest).toHaveBeenCalledWith('/favorites', expect.anything())
    )
    mockApiRequest.mockResolvedValueOnce({ favorite: { ...favoriteRecord }, existed: false })
    const { existed } = await favorites.addFavorite(input)
    expect(existed).toBe(false)
    expect(favorites.isFavorite('xiaoqu', 'B1')).toBe(true)
    expect(favorites.isFavorite('facility', 'B1')).toBe(false)
  })

  it('addFavorite 幂等：服务端 existed=true → 本地不重复插入', async () => {
    loginAs(TEST_USER)
    const { useFavorites } = await importFreshFavorites()
    const favorites = useFavorites()
    await vi.waitFor(() =>
      expect(mockApiRequest).toHaveBeenCalledWith('/favorites', expect.anything())
    )
    mockApiRequest.mockResolvedValue({ favorite: { ...favoriteRecord }, existed: true })
    await favorites.addFavorite(input)
    await favorites.addFavorite(input)
    expect(favorites.favorites.value).toHaveLength(1)
  })

  it('removeFavorite → DELETE 调用并从列表移除', async () => {
    loginAs(TEST_USER)
    // mock 在 import（触发 watch 拉取）之前就位：GET 返回 1 条，DELETE 返回 removed
    mockApiRequest.mockImplementation((_path: string, options?: { method?: string }) => {
      if (options?.method === 'DELETE') {
        return Promise.resolve({ removed: true })
      }
      return Promise.resolve([{ ...favoriteRecord }])
    })
    const { useFavorites } = await importFreshFavorites()
    const favorites = useFavorites()
    await vi.waitFor(() => expect(favorites.favorites.value).toHaveLength(1))
    const removed = await favorites.removeFavorite('xiaoqu', 'B1')
    expect(removed).toBe(true)
    expect(favorites.favorites.value).toHaveLength(0)
  })

  it('未登录收藏意图 → 登录成功后自动补完（GET + POST）', async () => {
    const { useFavorites } = await importFreshFavorites()
    const favorites = useFavorites()
    favorites.queuePendingFavorite(input)
    // mock 在 loginAs 之前就位：GET 空，POST 返回收藏项
    mockApiRequest.mockImplementation((_path: string, options?: { method?: string }) => {
      if (options?.method === 'POST') {
        return Promise.resolve({
          favorite: { id: 'f1', userId: 'u1', ...input, savedAt: 't' },
          existed: false,
        })
      }
      return Promise.resolve([])
    })
    loginAs(TEST_USER)
    await vi.waitFor(() =>
      expect(favorites.favorites.value.some((f) => f.itemId === 'B1')).toBe(true)
    )
  })

  it('登出 → 全局收藏清空', async () => {
    // mock 在 import 之前就位：GET 返回 1 条收藏
    mockApiRequest.mockImplementation(() => [{ ...favoriteRecord }])
    loginAs(TEST_USER)
    const { useFavorites } = await importFreshFavorites()
    const favorites = useFavorites()
    await vi.waitFor(() => expect(favorites.favorites.value).toHaveLength(1))
    logout()
    await nextTick()
    expect(favorites.favorites.value).toHaveLength(0)
  })
})

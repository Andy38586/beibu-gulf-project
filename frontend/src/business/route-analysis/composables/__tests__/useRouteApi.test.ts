import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorCode } from '@/shared'

// 部分 mock @/shared: 保留真实 useApiRequest,替换副作用函数
vi.mock('@/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared')>()
  return {
    ...actual,
    handleAuthError: vi.fn(),
    showError: vi.fn(),
  }
})

import { useRouteApi } from '../useRouteApi'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('useRouteApi — searchPois 取消语义（审查 M-6 回归）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', mockFetch)
  })

  it('searchPois 透传 signal：卸载/抢占可中止兜底 POI 请求', async () => {
    let capturedSignal: AbortSignal | null | undefined
    mockFetch.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          capturedSignal = init.signal
          init.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
          )
        })
    )
    const ac = new AbortController()
    const { searchPois } = useRouteApi()
    const pending = searchPois('', 30, ac.signal)

    ac.abort()
    await expect(pending).rejects.toMatchObject({ code: ErrorCode.REQUEST_FAILED })
    expect(capturedSignal?.aborted).toBe(true)
  })
})

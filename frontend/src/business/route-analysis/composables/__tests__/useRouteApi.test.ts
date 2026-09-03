import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, ErrorCode } from '@/shared'

// 部分 mock @/shared: 保留真实 useApiRequest,替换副作用函数
vi.mock('@/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared')>()
  return {
    ...actual,
    handleAuthError: vi.fn(),
    showError: vi.fn(),
  }
})

import { useApiRequest } from '@/shared'

import { useRouteApi } from '../useRouteApi'

// mock fetch（apiRequest 内部走 fetch；/flood-online 前缀跨服务直通，envelope:false 不解信封）
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function rawResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(data)),
  }
}

describe('useRouteApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const { clearToken } = useApiRequest()
    clearToken()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', mockFetch)
  })

  it('成功路径：返回 found 结果并复位 calculating', async () => {
    mockFetch.mockResolvedValueOnce(
      rawResponse({
        found: true,
        mode: 'distance',
        distanceM: 8600,
        durationMin: 15.5,
        snapDistanceM: { from: 250, to: 81 },
        edgeCount: 30,
        coordinates: [
          [108.6, 21.6],
          [108.7, 21.7],
        ],
      })
    )
    const { queryPath, calculating } = useRouteApi()
    const result = await queryPath({
      fromLng: 108.6,
      fromLat: 21.6,
      toLng: 108.7,
      toLat: 21.7,
      mode: 'distance',
    })
    expect(result).toMatchObject({ found: true, distanceM: 8600 })
    // 请求打到 /flood-online 前缀（跨服务直通），不被 envelope 解包
    expect(mockFetch.mock.calls[0][0]).toContain('/flood-online/route/path')
    expect(calculating.value).toBe(false)
  })

  it('合法空结果（不可达）透传 found:false，不视为错误', async () => {
    mockFetch.mockResolvedValueOnce(rawResponse({ found: false, reason: 'unreachable' }))
    const { queryPath, calcError } = useRouteApi()
    const result = await queryPath({ fromLng: 1, fromLat: 2, toLng: 3, toLat: 4 })
    expect(result).toEqual({ found: false, reason: 'unreachable' })
    expect(calcError.value).toBe('')
  })

  it('HTTP 500 → 抛 ApiError 且写入 calcError', async () => {
    mockFetch.mockResolvedValueOnce(rawResponse({ detail: 'boom' }, 500))
    const { queryPath, calcError } = useRouteApi()
    await expect(queryPath({ fromLng: 1, fromLat: 2, toLng: 3, toLat: 4 })).rejects.toBeInstanceOf(
      ApiError
    )
    expect(calcError.value).not.toBe('')
  })

  it('响应形状不符 schema → 抛 ApiError(REQUEST_FAILED)，不穿透坏数据', async () => {
    // coordinates 是 [lng,lat] 二维数组，给错形状（缺层）应由 zod 拦截
    mockFetch.mockResolvedValueOnce(
      rawResponse({ found: true, mode: 'distance', coordinates: [[108.6]] })
    )
    const { queryPath } = useRouteApi()
    const err = await queryPath({ fromLng: 1, fromLat: 2, toLng: 3, toLat: 4 }).catch(
      (e: unknown) => e
    )
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe(ErrorCode.REQUEST_FAILED)
  })

  it('取消在途请求:计算中 abort 后返回合法空（静默不写错误）', async () => {
    // 模拟真实 fetch 的 abort 行为：signal abort 时 reject AbortError（真实 fetch 如是）
    mockFetch.mockImplementationOnce(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal
          if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'))
            return
          }
          const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
          signal?.addEventListener('abort', onAbort, { once: true })
        })
    )
    const { queryPath, cancel, calcError } = useRouteApi()
    const pending = queryPath({ fromLng: 1, fromLat: 2, toLng: 3, toLat: 4 })
    cancel() // 取消在途请求（AbortController.abort → fetch reject）
    const result = await pending
    expect(result.found).toBe(false)
    expect(calcError.value).toBe('')
  })
})

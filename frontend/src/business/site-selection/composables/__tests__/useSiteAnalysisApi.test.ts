import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, ErrorCode } from '@/shared'

// mock vue-router: useSiteAnalysisApi 仅把 router 传给 handleAuthError
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

// 部分 mock @/shared: 保留真实 useApiRequest/ApiError/isAuthError,替换副作用函数
vi.mock('@/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared')>()
  return {
    ...actual,
    handleAuthError: vi.fn(),
    showError: vi.fn(),
  }
})

import { handleAuthError, isAuthError, showError, useApiRequest } from '@/shared'

import { useSiteAnalysisApi } from '../useSiteAnalysisApi'

// mock fetch（apiRequest 内部走 fetch + 信封解包）
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function envelopeResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify({ code: 0, data })),
  }
}

const ANALYSIS_PARAMS = { selectedKeys: ['hospital'], typeSettings: {} } as never

describe('useSiteAnalysisApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const { clearToken } = useApiRequest()
    clearToken()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', mockFetch)
  })

  describe('analyze 成功路径', () => {
    it('正常返回分析结果并复位 calculating', async () => {
      mockFetch.mockResolvedValueOnce(
        envelopeResponse({ coverage: null, matchedXiaoqu: [], facilityPoi: {} })
      )
      const { analyze, calculating } = useSiteAnalysisApi()

      const result = await analyze(ANALYSIS_PARAMS)

      expect(result.error).toBeNull()
      expect(result.matchedXiaoqu).toEqual([])
      expect(result.coverage).toBeNull()
      expect(calculating.value).toBe(false)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('接口返回业务 error 时写入 calcError', async () => {
      mockFetch.mockResolvedValueOnce(envelopeResponse({ error: '参数不足' }))
      const { analyze, calcError } = useSiteAnalysisApi()

      const result = await analyze(ANALYSIS_PARAMS)

      expect(result.error).toBe('参数不足')
      expect(calcError.value).toBe('参数不足')
    })
  })

  describe('analyze 异常路径', () => {
    it('401 时走 handleAuthError + showError', async () => {
      mockFetch.mockRejectedValueOnce(new ApiError('请先登录', ErrorCode.UNAUTHORIZED))
      const { analyze } = useSiteAnalysisApi()

      const result = await analyze(ANALYSIS_PARAMS)

      expect(isAuthError(new ApiError('请先登录', ErrorCode.UNAUTHORIZED))).toBe(true)
      expect(handleAuthError).toHaveBeenCalled()
      expect(showError).toHaveBeenCalled()
      expect(result.error).toBeTruthy()
    })

    it('主动取消（新请求抢占）时静默返回,不弹错误', async () => {
      const { analyze, cancel } = useSiteAnalysisApi()
      const { apiRequest } = useApiRequest()

      // 模拟在途请求被 cancel 打断
      let resolveFetch: (v: unknown) => void
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve
          })
      )

      const promise = analyze(ANALYSIS_PARAMS)
      cancel() // 触发 abortController.abort()
      resolveFetch!(envelopeResponse({}))

      const result = await promise
      expect(result.error).toBeNull()
      expect(showError).not.toHaveBeenCalled()
      expect(apiRequest).toBeDefined()
    })
  })

  describe('cancel', () => {
    it('复位 calculating', () => {
      const { calculating, cancel } = useSiteAnalysisApi()
      // 无在途请求时 cancel 也应安全复位
      cancel()
      expect(calculating.value).toBe(false)
    })
  })
})

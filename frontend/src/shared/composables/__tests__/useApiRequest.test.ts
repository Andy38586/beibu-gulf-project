import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, ErrorCode, useApiRequest } from '../useApiRequest'

// mock fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(data)),
  }
}

describe('useApiRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('token 管理', () => {
    it('初始状态未认证', () => {
      const { isAuthenticated, clearToken } = useApiRequest()
      clearToken()
      expect(isAuthenticated.value).toBe(false)
    })

    it('setToken 后 isAuthenticated 为 true', () => {
      const { isAuthenticated, setToken, clearToken } = useApiRequest()
      setToken('test-token')
      expect(isAuthenticated.value).toBe(true)
      clearToken()
    })

    it('clearToken 后 isAuthenticated 为 false', () => {
      const { isAuthenticated, setToken, clearToken } = useApiRequest()
      setToken('test-token')
      clearToken()
      expect(isAuthenticated.value).toBe(false)
    })
  })

  describe('apiRequest 信封解包', () => {
    it('自动解包 { code, data } 信封', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ code: 200, data: { name: 'test' } }))
      const { apiRequest } = useApiRequest()
      const result = await apiRequest('/test')
      expect(result).toEqual({ name: 'test' })
    })

    it('非信封响应直接返回', async () => {
      mockFetch.mockResolvedValue(jsonResponse([1, 2, 3]))
      const { apiRequest } = useApiRequest()
      const result = await apiRequest('/test')
      expect(result).toEqual([1, 2, 3])
    })
  })

  describe('错误处理', () => {
    it('401 抛 UNAUTHORIZED', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: '未登录' }, 401))
      const { apiRequest } = useApiRequest()
      await expect(apiRequest('/protected')).rejects.toThrow(ApiError)
      await expect(apiRequest('/protected')).rejects.toMatchObject({
        code: ErrorCode.UNAUTHORIZED,
      })
    })

    it('500 抛 SERVER_ERROR', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: '内部错误' }, 500))
      const { apiRequest } = useApiRequest()
      await expect(apiRequest('/fail')).rejects.toMatchObject({
        code: ErrorCode.SERVER_ERROR,
      })
    })

    it('400 抛 REQUEST_FAILED 并携带后端 error 信息', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: '参数无效' }, 400))
      const { apiRequest } = useApiRequest()
      await expect(apiRequest('/bad')).rejects.toMatchObject({
        code: ErrorCode.REQUEST_FAILED,
        message: '参数无效',
      })
    })

    it('网络异常抛 NETWORK_ERROR', async () => {
      mockFetch.mockRejectedValue(new TypeError('fetch failed'))
      const { apiRequest } = useApiRequest()
      await expect(apiRequest('/offline')).rejects.toMatchObject({
        code: ErrorCode.NETWORK_ERROR,
      })
    })
  })

  describe('params 拼接', () => {
    it('正确拼接 query 参数', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ code: 200, data: null }))
      const { apiRequest } = useApiRequest()
      await apiRequest('/search', { params: { q: 'test', page: 1, empty: null } })
      const calledUrl = mockFetch.mock.calls[0][0]
      expect(calledUrl).toContain('q=test')
      expect(calledUrl).toContain('page=1')
      expect(calledUrl).not.toContain('empty')
    })
  })
})

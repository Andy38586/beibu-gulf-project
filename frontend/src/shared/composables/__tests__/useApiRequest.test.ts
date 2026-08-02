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
  })

  afterEach(() => {
    // 本文件统一使用真实定时器：请求内的 10s 超时在 mock 响应后均被 clearTimeout 清除，不会真实等待
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

    it('网络异常抛 NETWORK_ERROR（含重试，最终仍抛出）', async () => {
      mockFetch.mockRejectedValue(new TypeError('fetch failed'))
      const { apiRequest } = useApiRequest()
      await expect(apiRequest('/offline')).rejects.toMatchObject({
        code: ErrorCode.NETWORK_ERROR,
      })
      // GET + NETWORK_ERROR 可重试，最多 3 次（线性退避 0.8/1.6/2.4s，真实定时器下约 2.4s）
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })
  })

  describe('请求重试 (z049)', () => {
    it('GET 网络错误重试，第3次成功时返回结果且 fetch 调用3次', async () => {
      mockFetch
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(jsonResponse({ code: 200, data: { ok: true } }))
      const { apiRequest } = useApiRequest()
      await expect(apiRequest('/test')).resolves.toEqual({ ok: true })
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('POST 失败不重试', async () => {
      mockFetch.mockRejectedValue(new TypeError('fetch failed'))
      const { apiRequest } = useApiRequest()
      await expect(apiRequest('/submit', { method: 'POST', body: '{}' })).rejects.toMatchObject({
        code: ErrorCode.NETWORK_ERROR,
      })
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('外部主动取消（已 abort 的 signal）不重试', async () => {
      const ac = new AbortController()
      ac.abort()
      // 模拟 fetch 因 signal abort 抛出的 AbortError：
      // 必须为 Error 实例且 name='AbortError' 才会被 _singleRequest 转换为 ApiError.REQUEST_FAILED
      const abortErr = new Error('The operation was aborted')
      abortErr.name = 'AbortError'
      mockFetch.mockRejectedValue(abortErr)
      const { apiRequest } = useApiRequest()
      await expect(apiRequest('/test', { signal: ac.signal })).rejects.toMatchObject({
        code: ErrorCode.REQUEST_FAILED,
      })
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('非重试错误码（500）不重试', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: '内部错误' }, 500))
      const { apiRequest } = useApiRequest()
      await expect(apiRequest('/fail')).rejects.toMatchObject({ code: ErrorCode.SERVER_ERROR })
      expect(mockFetch).toHaveBeenCalledTimes(1)
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

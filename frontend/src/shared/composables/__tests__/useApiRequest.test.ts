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

    it('HTTP 200 但信封 code≥400 显式失败（D2：错误数据不当成功解包）', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ code: 500, data: { error: '业务失败' } }, 200))
      const { apiRequest } = useApiRequest()
      await expect(apiRequest('/test')).rejects.toMatchObject({
        code: ErrorCode.REQUEST_FAILED,
      })
    })

    it('HTTP 200 信封 code=2xx 正常解包（201 等成功状态）', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ code: 201, data: { id: 1 } }, 200))
      const { apiRequest } = useApiRequest()
      await expect(apiRequest('/test')).resolves.toEqual({ id: 1 })
    })
  })

  describe('错误处理', () => {
    it('401 抛 UNAUTHORIZED（文案透传服务端）', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: '未登录' }, 401))
      const { apiRequest } = useApiRequest()
      await expect(apiRequest('/protected')).rejects.toThrow(ApiError)
      await expect(apiRequest('/protected')).rejects.toMatchObject({
        code: ErrorCode.UNAUTHORIZED,
        message: '未登录',
      })
    })

    it('401 携带后端业务码（信封 code → ApiError.bizCode，供登录细分语义）', async () => {
      mockFetch.mockResolvedValue(
        jsonResponse({ code: 401002, error: '账号不存在，请先注册', data: null }, 401)
      )
      const { apiRequest } = useApiRequest()
      await expect(apiRequest('/auth/login', { method: 'POST' })).rejects.toMatchObject({
        code: ErrorCode.UNAUTHORIZED,
        message: '账号不存在，请先注册',
        bizCode: 401002,
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

  describe('API_BASE 前缀判定 (d071)', () => {
    // d071：/flood-online 开头（vite proxy → FastAPI 8000）不加 /api 前缀，
    // 否则变成 /api/flood-online/... 命中 /api 规则转发到 Express（无此路由）404
    it('/flood-online 路径不加 /api 前缀（跨服务直通）', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ level: 3.5, features: [] }))
      const { apiRequest } = useApiRequest()
      await apiRequest('/flood-online/online?level=3.5', { envelope: false })
      expect(mockFetch.mock.calls[0][0]).toBe('/flood-online/online?level=3.5')
      expect(mockFetch.mock.calls[0][0]).not.toContain('/api/')
    })

    it('普通路径加 /api 前缀', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ code: 200, data: null }))
      const { apiRequest } = useApiRequest()
      await apiRequest('/forecast/overview')
      expect(mockFetch.mock.calls[0][0]).toBe('/api/forecast/overview')
    })

    it('/flood-online 子路径（含 params 拼查询）同样不加前缀', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ level: 5.0, features: [] }))
      const { apiRequest } = useApiRequest()
      await apiRequest('/flood-online/online', { params: { level: 5.0 }, envelope: false })
      const calledUrl = mockFetch.mock.calls[0][0]
      expect(calledUrl.startsWith('/flood-online/online')).toBe(true)
      expect(calledUrl).not.toContain('/api/')
      expect(calledUrl).toContain('level=5')
    })
  })

  describe('网关 5xx 归「服务器无响应」', () => {
    // nginx/vite proxy 对宕机后端返回 502/503/504：语义是后端不可达而非应用错误，
    // 归 SERVER_ERROR 让 describeError 统一按「服务器无响应」提示（不误报成登录问题）
    it.each([502, 503, 504])(
      'HTTP %i → ApiError(SERVER_ERROR,「服务器无响应」)',
      async (status) => {
        mockFetch.mockResolvedValue(jsonResponse('Bad Gateway', status))
        const { apiRequest } = useApiRequest()
        await expect(apiRequest('/plans')).rejects.toMatchObject({
          code: ErrorCode.SERVER_ERROR,
          message: '服务器无响应，请检查网络后重试',
        })
      }
    )
  })

  describe('per-module 前缀路由 (T6.2)', () => {
    // v3 T6.2：VITE_USE_NEST_MODULES 按批填功能域即切 Nest，清空回退 Express。
    // 前缀常量在模块求值时读取 import.meta.env，故用 vi.resetModules + 动态 import 隔离各用例
    afterEach(() => {
      delete import.meta.env.VITE_USE_NEST_MODULES
      delete import.meta.env.VITE_NEST_API_BASE
      vi.resetModules()
    })

    it('启用 auth/plans/favorites → 三域走 /nest-api，未启用域回退 Express', async () => {
      import.meta.env.VITE_USE_NEST_MODULES = 'auth,plans,favorites'
      mockFetch.mockResolvedValue(jsonResponse({ code: 200, data: null }))
      const { useApiRequest } = await import('../useApiRequest')
      const { apiRequest } = useApiRequest()
      await apiRequest('/auth/login', { method: 'POST' })
      await apiRequest('/plans', { method: 'POST' })
      await apiRequest('/favorites', { method: 'POST' })
      await apiRequest('/forecast/overview')
      expect(mockFetch.mock.calls[0][0]).toBe('/nest-api/auth/login')
      expect(mockFetch.mock.calls[1][0]).toBe('/nest-api/plans')
      expect(mockFetch.mock.calls[2][0]).toBe('/nest-api/favorites')
      expect(mockFetch.mock.calls[3][0]).toBe('/api/forecast/overview')
    })

    it('空白分隔容忍 + 显式 /nest-api/ 路径不叠加前缀', async () => {
      import.meta.env.VITE_USE_NEST_MODULES = ' flood , site-analysis '
      mockFetch.mockResolvedValue(jsonResponse({ code: 200, data: null }))
      const { useApiRequest } = await import('../useApiRequest')
      const { apiRequest } = useApiRequest()
      await apiRequest('/flood/water-area')
      await apiRequest('/site-analysis', { method: 'POST' })
      await apiRequest('/nest-api/auth/me')
      expect(mockFetch.mock.calls[0][0]).toBe('/nest-api/flood/water-area')
      expect(mockFetch.mock.calls[1][0]).toBe('/nest-api/site-analysis')
      expect(mockFetch.mock.calls[2][0]).toBe('/nest-api/auth/me')
    })

    it('自定义 VITE_NEST_API_BASE 生效', async () => {
      import.meta.env.VITE_USE_NEST_MODULES = 'flood'
      import.meta.env.VITE_NEST_API_BASE = '/v3-proxy'
      mockFetch.mockResolvedValue(jsonResponse({ code: 200, data: null }))
      const { useApiRequest } = await import('../useApiRequest')
      const { apiRequest } = useApiRequest()
      await apiRequest('/flood/flood-areas')
      expect(mockFetch.mock.calls[0][0]).toBe('/v3-proxy/flood/flood-areas')
    })
  })
})

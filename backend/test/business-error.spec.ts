import { describe, expect, it, vi } from 'vitest'
import { Logger } from '@nestjs/common'

import { BusinessError, ErrorCode } from '../src/common/errors/business-error'
import { BusinessErrorFilter } from '../src/common/filters/business-error.filter'

// 错误码表契约测试：与老 Express backend/utils/BusinessError.js 逐项一致（9 项）
describe('ErrorCode 契约（对齐 Express）', () => {
  const expected: Array<[key: string, code: number, status: number, message: string]> = [
    ['INVALID_PARAMS', 400001, 400, '参数验证失败'],
    ['UNAUTHORIZED', 401001, 401, '认证令牌无效或已过期'],
    ['USER_NOT_FOUND', 401002, 401, '账号不存在，请先注册'],
    ['WRONG_PASSWORD', 401003, 401, '密码错误'],
    ['FORBIDDEN', 403001, 403, '无权访问此资源'],
    ['NOT_FOUND', 404001, 404, '资源不存在'],
    ['DUPLICATE_USERNAME', 409001, 409, '用户名已存在'],
    ['DUPLICATE_RESOURCE', 409002, 409, '资源已存在'],
    ['ANALYSIS_FAILED', 422001, 422, '分析计算失败'],
  ]

  it.each(expected)('%s → code %i / status %i / 文案一致', (key, code, status, message) => {
    const entry = ErrorCode[key as keyof typeof ErrorCode]
    expect(entry.code).toBe(code)
    expect(entry.status).toBe(status)
    expect(entry.message).toBe(message)
  })

  it('BusinessError 携带 bizCode/status，detail 覆盖默认文案', () => {
    const err = new BusinessError(ErrorCode.INVALID_PARAMS, '用户名和密码不能为空')
    expect(err.bizCode).toBe(400001)
    expect(err.status).toBe(400)
    expect(err.message).toBe('用户名和密码不能为空')
    expect(err.name).toBe('BusinessError')
  })

  it('BusinessError 无 detail 时用默认文案', () => {
    const err = new BusinessError(ErrorCode.WRONG_PASSWORD)
    expect(err.message).toBe('密码错误')
  })
})

// BusinessError.message 可来自请求输入，必须净化后写日志并回显
// （对齐 csp-report.controller 的 clip 口径：滤 CR/LF + 200 字截断）
describe('BusinessErrorFilter 详情净化', () => {
  function fakeHost(reqHeaders: Record<string, string | string[] | undefined> = {}) {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }
    return {
      host: {
        switchToHttp: () => ({
          getResponse: () => res,
          getRequest: () => ({ headers: reqHeaders }),
        }),
      } as never,
      res,
    }
  }

  it('换行注入被滤平：日志单行、响应无 CR/LF（阳性对照：不过滤时 error 含 \n）', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    try {
      const { host, res } = fakeHost()
      new BusinessErrorFilter().catch(
        new BusinessError(ErrorCode.INVALID_PARAMS, 'bad\n[FAKE] 2026-09-22 伪造日志行'),
        host
      )
      const body = res.json.mock.calls[0][0] as { error: string }
      expect(body.error).not.toMatch(/[\r\n]/)
      expect(body.error).toContain('[FAKE]')
      expect(warnSpy).toHaveBeenCalledTimes(1)
      const logged = String(warnSpy.mock.calls[0][0])
      expect(logged.split('\n')).toHaveLength(1)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('超长 message 截断到 200 字并加省略号', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    try {
      const { host, res } = fakeHost()
      new BusinessErrorFilter().catch(
        new BusinessError(ErrorCode.INVALID_PARAMS, 'x'.repeat(500)),
        host
      )
      const body = res.json.mock.calls[0][0] as { error: string }
      expect(body.error).toHaveLength(201) // 200 + '…'
      expect(body.error.endsWith('…')).toBe(true)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('正常业务文案原样下发（不误伤）', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    try {
      const { host, res } = fakeHost()
      new BusinessErrorFilter().catch(
        new BusinessError(ErrorCode.INVALID_PARAMS, 'mode 必须为 distance / time，收到：fastest'),
        host
      )
      const body = res.json.mock.calls[0][0] as { error: string }
      expect(body.error).toBe('mode 必须为 distance / time，收到：fastest')
    } finally {
      warnSpy.mockRestore()
    }
  })
})

// 前端 useApiRequest 每次请求写 x-request-id，后端错误日志必须带上同一个值——
// 否则「用户报障 → 查服务端日志」这一步只能靠时间戳猜。
describe('BusinessErrorFilter 请求关联 id', () => {
  function hostOf(headers: Record<string, string | string[] | undefined>) {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
    return {
      host: {
        switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ headers }) }),
      } as never,
      res,
    }
  }

  it('🔴 业务错误的 warn 日志带上请求头里的 rid', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    try {
      const { host } = hostOf({ 'x-request-id': 'r7-abc123' })
      new BusinessErrorFilter().catch(new BusinessError(ErrorCode.NOT_FOUND), host)
      const logged = String(warnSpy.mock.calls[0][0])
      expect(logged).toContain('r7-abc123')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('🔴 未捕获错误的 error 日志也带 rid（这条通道此前完全没有关联键）', () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {})
    try {
      const { host } = hostOf({ 'x-request-id': 'r9-zzz' })
      new BusinessErrorFilter().catch(new Error('boom'), host)
      expect(String(errorSpy.mock.calls[0][0])).toContain('r9-zzz')
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('🔴 头值里的换行被滤平：rid 是攻击面，日志必须仍是单行', () => {
    // 阳性对照：不净化时下面这个值会把日志劈成两行，伪造出一条 [BusinessError] 记录
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    try {
      const { host } = hostOf({ 'x-request-id': 'r1\n[BusinessError] 401 401001: 伪造' })
      new BusinessErrorFilter().catch(new BusinessError(ErrorCode.NOT_FOUND), host)
      const logged = String(warnSpy.mock.calls[0][0])
      expect(logged.split('\n')).toHaveLength(1)
      expect(logged).not.toMatch(/[\r\n]/)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('缺头时不崩、日志仍可读（老客户端/直连 curl）', () => {
    // 只钉「不崩 + 不把 undefined 写进日志」，不钉占位符的形状——那是可等价改写的措辞
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    try {
      const { host } = hostOf({})
      expect(() =>
        new BusinessErrorFilter().catch(new BusinessError(ErrorCode.NOT_FOUND), host)
      ).not.toThrow()
      const logged = String(warnSpy.mock.calls[0][0])
      expect(logged).not.toContain('undefined')
      expect(logged.split('\n')).toHaveLength(1)
    } finally {
      warnSpy.mockRestore()
    }
  })
})

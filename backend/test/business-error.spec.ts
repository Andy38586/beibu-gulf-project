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
  function fakeHost() {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }
    return {
      host: { switchToHttp: () => ({ getResponse: () => res }) } as never,
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

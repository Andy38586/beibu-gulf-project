import { describe, expect, it } from 'vitest'

import { BusinessError, ErrorCode } from '../src/common/errors/business-error'

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

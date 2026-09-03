import { describe, expect, it } from 'vitest'

import { BusinessError, ErrorCode } from '../src/common/errors/business-error'
import { DtoPipe } from '../src/common/pipes/dto.pipe'
import { LoginBody, RegisterBody } from '../src/modules/auth/dto/auth.dto'

// DTO 白名单校验：文案与顺序逐字节对齐 Express authController（差异即缺陷）
function expectBiz(fn: () => unknown, code: number, message: string): void {
  try {
    fn()
    expect.unreachable('应抛出 BusinessError')
  } catch (err) {
    expect(err).toBeInstanceOf(BusinessError)
    const biz = err as BusinessError
    expect(biz.bizCode).toBe(code)
    expect(biz.message).toBe(message)
    expect(biz.status).toBe(400)
  }
}

describe('RegisterBody.parse（对齐 Express register 校验）', () => {
  it('空入参 → 400001 用户名和密码不能为空', () => {
    expectBiz(() => RegisterBody.parse({}), ErrorCode.INVALID_PARAMS.code, '用户名和密码不能为空')
  })

  it('缺一字段 → 400001 用户名和密码不能为空', () => {
    expectBiz(
      () => RegisterBody.parse({ username: 'ab' }),
      ErrorCode.INVALID_PARAMS.code,
      '用户名和密码不能为空'
    )
  })

  it('用户名过短/过长 → 400001 用户名长度应在 2-20 个字符之间', () => {
    for (const name of ['a', 'x'.repeat(21)]) {
      expectBiz(
        () => RegisterBody.parse({ username: name, password: 'Abcdef1' }),
        ErrorCode.INVALID_PARAMS.code,
        '用户名长度应在 2-20 个字符之间'
      )
    }
  })

  it('密码过短 → 400001 密码长度不能少于 6 位', () => {
    expectBiz(
      () => RegisterBody.parse({ username: 'ab', password: 'Ab1' }),
      ErrorCode.INVALID_PARAMS.code,
      '密码长度不能少于 6 位'
    )
  })

  it('密码缺强度 → 400001 密码必须包含大小写字母和数字', () => {
    expectBiz(
      () => RegisterBody.parse({ username: 'ab', password: 'abcdef' }),
      ErrorCode.INVALID_PARAMS.code,
      '密码必须包含大小写字母和数字'
    )
  })

  it('非字符串类型 → 400001（白名单收口，Express 带病穿透路径不再放行）', () => {
    expectBiz(
      () => RegisterBody.parse({ username: 123, password: 'Abcdef1' }),
      ErrorCode.INVALID_PARAMS.code,
      '用户名和密码必须为字符串'
    )
  })

  it('合法入参 → 白名单字段保留，多余键丢弃', () => {
    const dto = RegisterBody.parse({
      username: 'ab',
      password: 'Abcdef1',
      role: 'admin',
      isAdmin: true,
    })
    expect(dto.username).toBe('ab')
    expect(dto.password).toBe('Abcdef1')
    expect(Object.keys(dto).sort()).toEqual(['password', 'username'])
  })
})

describe('LoginBody.parse（对齐 Express login 校验：只有非空一道）', () => {
  it('空入参 → 400001 用户名和密码不能为空', () => {
    expectBiz(() => LoginBody.parse({}), ErrorCode.INVALID_PARAMS.code, '用户名和密码不能为空')
  })

  it('登录不做长度/强度校验（弱密码进入比对通道，文案对齐）', () => {
    const dto = LoginBody.parse({ username: 'legacy_user', password: '123' })
    expect(dto.username).toBe('legacy_user')
    expect(dto.password).toBe('123')
  })

  it('null/数组入参按空对象处理 → 400001 用户名和密码不能为空', () => {
    expectBiz(() => LoginBody.parse(null), ErrorCode.INVALID_PARAMS.code, '用户名和密码不能为空')
  })
})

describe('DtoPipe', () => {
  it('transform 委托 DTO.parse（统一白名单收口点）', () => {
    const pipe = new DtoPipe(LoginBody.parse)
    const dto = pipe.transform({ username: 'u', password: 'p' })
    expect(dto).toEqual({ username: 'u', password: 'p' })
  })
})

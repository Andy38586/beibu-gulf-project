// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { sanitize } from '../logSanitizer.js'

describe('sanitize (d065) 请求日志脱敏', () => {
  it('password 字符串打码（保留前 2 字符）', () => {
    expect(sanitize('secretpass', 'password')).toBe('se***')
  })

  it('token 在嵌套对象中打码', () => {
    const out = sanitize({ user: { token: 'abcdef123456' } })
    expect(out.user.token).toBe('ab***')
  })

  it('authorization 键打码', () => {
    // 直接传字符串值：敏感 key + 字符串值 → 保留前 2 字符（与 password 用例一致）
    const out = sanitize('Bearer xyz', 'authorization')
    expect(out).toBe('Be***')
  })

  it('cookie 键打码', () => {
    // 直接传字符串值：敏感 key + 字符串值 → 保留前 2 字符（与 password 用例一致）
    const out = sanitize('sessionid=abc', 'cookie')
    expect(out).toBe('se***')
  })

  it('secret 非字符串值打码为 ***', () => {
    expect(sanitize({ secret: 12345 }, 'secret')).toBe('***')
  })

  it('非敏感字段原样返回', () => {
    expect(sanitize({ name: 'happY', age: 21 })).toEqual({ name: 'happY', age: 21 })
  })

  it('数组逐元素处理', () => {
    expect(sanitize([{ password: 'aaa' }, { name: 'b' }])).toEqual([
      { password: 'aa***' },
      { name: 'b' },
    ])
  })
})

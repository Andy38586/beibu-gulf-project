import { describe, expect, it } from 'vitest'

import { unwrapEnvelope } from '../responseEnvelope'

describe('unwrapEnvelope (z063)', () => {
  it('解包标准 { code, data } 信封', () => {
    expect(unwrapEnvelope({ code: 200, data: { name: 'test' } })).toEqual({ name: 'test' })
  })

  it('非对象原样返回（数组）', () => {
    expect(unwrapEnvelope([1, 2, 3])).toEqual([1, 2, 3])
  })

  it('非对象原样返回（原始值）', () => {
    expect(unwrapEnvelope('plain')).toBe('plain')
    expect(unwrapEnvelope(42)).toBe(42)
    expect(unwrapEnvelope(null)).toBe(null)
  })

  it('缺 code 字段不解包', () => {
    expect(unwrapEnvelope({ data: { a: 1 } })).toEqual({ data: { a: 1 } })
  })

  it('缺 data 字段不解包', () => {
    expect(unwrapEnvelope({ code: 200, msg: 'x' })).toEqual({ code: 200, msg: 'x' })
  })

  it('REQ-1: 带扩展字段（message/timestamp）的信封仍解包', () => {
    expect(
      unwrapEnvelope({ code: 200, data: [1, 2], message: 'ok', timestamp: 123 })
    ).toEqual([1, 2])
  })

  it('嵌套 data 原样返回内部结构', () => {
    expect(unwrapEnvelope({ code: 0, data: { list: [1], meta: { total: 1 } } })).toEqual({
      list: [1],
      meta: { total: 1 },
    })
  })
})

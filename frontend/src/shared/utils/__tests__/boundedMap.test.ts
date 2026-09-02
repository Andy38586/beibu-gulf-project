import { describe, expect, it } from 'vitest'

import { BoundedMap } from '../boundedMap'

describe('BoundedMap', () => {
  it('未达上限时按插入序累积', () => {
    const m = new BoundedMap<string, number>(3)
    m.set('a', 1)
    m.set('b', 2)
    expect(m.size).toBe(2)
    expect(m.get('a')).toBe(1)
  })

  it('超限时淘汰插入序最旧键', () => {
    const m = new BoundedMap<string, number>(3)
    m.set('a', 1)
    m.set('b', 2)
    m.set('c', 3)
    m.set('d', 4)
    expect(m.size).toBe(3)
    expect(m.has('a')).toBe(false)
    expect(m.get('b')).toBe(2)
    expect(m.get('d')).toBe(4)
  })

  it('同键覆盖不触发淘汰（不增加容量占用）', () => {
    const m = new BoundedMap<string, number>(2)
    m.set('a', 1)
    m.set('b', 2)
    m.set('a', 10) // 覆盖已有键
    expect(m.size).toBe(2)
    expect(m.get('a')).toBe(10)
  })

  it('继承 Map 迭代/序列化能力（Array.from(entries) 与 forEach）', () => {
    const m = new BoundedMap<string, number>(2)
    m.set('k1', 1)
    m.set('k2', 2)
    expect(Array.from(m.entries())).toEqual([
      ['k1', 1],
      ['k2', 2],
    ])
    const seen: string[] = []
    m.forEach((_v, k) => seen.push(k))
    expect(seen).toEqual(['k1', 'k2'])
  })

  it('delete/clear 与 Map 语义一致', () => {
    const m = new BoundedMap<string, number>(2)
    m.set('a', 1)
    m.set('b', 2)
    m.delete('a')
    expect(m.has('a')).toBe(false)
    m.clear()
    expect(m.size).toBe(0)
  })

  it('非法上限拒绝构造', () => {
    expect(() => new BoundedMap(0)).toThrow(RangeError)
    expect(() => new BoundedMap(-1)).toThrow(RangeError)
  })
})

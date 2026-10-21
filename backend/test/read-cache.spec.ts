import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createReadCache } from '../src/common/cache/read-cache'

// W70：read-cache 是缓存语义的唯一实现（TTL + 容量上限 + 不挪序），此前 0 单测。
// 三个语义各自对应一条能红用例：TTL 过期不返回旧值、超上限淘汰最旧、读命中不刷新顺序。
describe('createReadCache（TTL 与容量语义）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-21T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('TTL 内命中返回原值', () => {
    const cache = createReadCache<number>({ ttlMs: 1000 })
    cache.set('a', 1)
    vi.advanceTimersByTime(999)
    expect(cache.get('a')).toBe(1)
  })

  it('🔴 TTL 过期后返回 undefined（过期即删，不返回陈旧值）', () => {
    const cache = createReadCache<number>({ ttlMs: 1000 })
    cache.set('a', 1)
    vi.advanceTimersByTime(1001)
    expect(cache.get('a')).toBeUndefined()
  })

  it('达到上限时淘汰最旧插入项', () => {
    const cache = createReadCache<number>({ maxSize: 2 })
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
  })

  it('🔴 读命中不刷新顺序：读过 a 之后插入 c，被淘汰的仍是 a', () => {
    const cache = createReadCache<number>({ maxSize: 2 })
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBe(1) // 读命中不应把它挪到队尾
    cache.set('c', 3)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
  })
})

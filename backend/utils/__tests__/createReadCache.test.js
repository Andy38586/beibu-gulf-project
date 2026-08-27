/**
 * 8-3 修复：createReadCache 单元测试（此前零测试引用）。
 * 覆盖：命中/未命中、TTL 过期删除、FIFO 近似 LRU 上限淘汰、has/clear。
 */
import { describe, expect, it } from 'vitest'

import { createReadCache } from '../createReadCache.js'

describe('createReadCache (8-3)', () => {
  it('未命中返回 undefined，命中返回缓存值', () => {
    const c = createReadCache()
    expect(c.get('a')).toBeUndefined()
    c.set('a', 1)
    expect(c.get('a')).toBe(1)
  })

  it('TTL 过期后删除条目并返回 undefined', async () => {
    const c = createReadCache({ ttlMs: 20 })
    c.set('a', 1)
    expect(c.get('a')).toBe(1)
    await new Promise((r) => setTimeout(r, 40))
    expect(c.get('a')).toBeUndefined()
    expect(c.has('a')).toBe(false)
  })

  it('has 独立校验 TTL：过期条目不经 get 也返回 false', async () => {
    const c = createReadCache({ ttlMs: 20 })
    c.set('a', 1)
    await new Promise((r) => setTimeout(r, 40))
    // has 若只查 Map 键存在，过期后仍返回 true，与随后的 get undefined 矛盾
    expect(c.has('a')).toBe(false)
  })

  it('超过 maxSize 淘汰最旧插入项（FIFO 近似 LRU，读命中不挪序）', () => {
    const c = createReadCache({ maxSize: 2 })
    c.set('a', 1)
    c.set('b', 2)
    c.get('a') // 读命中不刷新顺序（设计语义）
    c.set('c', 3) // 触发淘汰：应淘汰最旧插入的 'a'
    expect(c.has('a')).toBe(false)
    expect(c.get('b')).toBe(2)
    expect(c.get('c')).toBe(3)
  })

  it('has / clear / size 行为', () => {
    const c = createReadCache()
    expect(c.size).toBe(0)
    c.set('a', 1)
    c.set('b', 2)
    expect(c.has('a')).toBe(true)
    expect(c.size).toBe(2)
    c.clear()
    expect(c.size).toBe(0)
    expect(c.has('a')).toBe(false)
  })
})

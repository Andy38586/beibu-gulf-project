import { describe, expect, it } from 'vitest'

import { seededRandom } from '../src/common/seeded-random'

// 原挂 morans-i.spec.ts（morans-i 已于 2026-10-06 减负删除）。
// 本用例守护生产消费方 forecast-engine 的"同种子同序列"可复现口径。

describe('seededRandom', () => {
  it('同种子同序列（Park-Miller 首值锚点）', () => {
    const r1 = seededRandom(7)
    const r2 = seededRandom(7)
    expect(r1()).toBe(r2())
    expect(r1()).toBe(r2())
  })
})

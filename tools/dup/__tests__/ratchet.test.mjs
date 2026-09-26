import { describe, expect, it } from 'vitest'

import { compare } from '../ratchet.mjs'

const BASE = {
  totalGroups: 10,
  totalRedundantTokens: 100,
  byModule: { 'frontend/src/core': 60, 跨模块: 40 },
}

describe('dup 棘轮 compare（基线只许下降或持平）', () => {
  it('组数上涨 ⇒ 红', () => {
    const bad = compare({ ...BASE, totalGroups: 11 }, BASE)
    expect(bad.some((b) => b.includes('totalGroups'))).toBe(true)
  })

  it('组数持平但 token 上涨 ⇒ 红（同一组长得更长也是恶化）', () => {
    const bad = compare({ ...BASE, totalRedundantTokens: 130 }, BASE)
    expect(bad.some((b) => b.includes('totalRedundantTokens'))).toBe(true)
    expect(bad.some((b) => b.includes('totalGroups'))).toBe(false)
  })

  it('全新文本的重复组 ⇒ 红（判据认总量，不认具体字面——换一种写法的违约照样红）', () => {
    const cur = {
      totalGroups: 11,
      totalRedundantTokens: 130,
      byModule: { ...BASE.byModule, 'frontend/src/core': 90 },
    }
    const bad = compare(cur, BASE)
    expect(bad.length).toBeGreaterThanOrEqual(2)
  })

  it('持平 ⇒ 不红', () => {
    expect(compare({ ...BASE }, BASE)).toEqual([])
  })

  it('下降 ⇒ 不红', () => {
    const cur = {
      totalGroups: 8,
      totalRedundantTokens: 80,
      byModule: { ...BASE.byModule, 'frontend/src/core': 40 },
    }
    expect(compare(cur, BASE)).toEqual([])
  })

  it('总量持平但单模块上涨 ⇒ 红（防 A 模块清、B 模块长的掩盖）', () => {
    const cur = {
      totalGroups: BASE.totalGroups,
      totalRedundantTokens: BASE.totalRedundantTokens,
      byModule: { 'frontend/src/core': 90, 跨模块: 10 },
    }
    const bad = compare(cur, BASE)
    expect(bad.some((b) => b.includes('frontend/src/core 冗余 token 上涨'))).toBe(true)
  })

  it('基线无 byModule ⇒ 跳过按模块比较（首次接线不误红存量）', () => {
    const baseNoMod = { totalGroups: 10, totalRedundantTokens: 100 }
    const cur = { totalGroups: 10, totalRedundantTokens: 100, byModule: { 'x/y/z': 999 } }
    expect(compare(cur, baseNoMod)).toEqual([])
  })
})

// @vitest-environment node
/**
 * 死物棘轮的自测（含红样）。
 *
 * 钉三件事：
 *   1) 总量上涨 ⇒ 必报；
 *   2) **按模块**上涨 ⇒ 必报 —— 这是防「A 模块清 5 个、B 模块长 5 个、总量持平」的
 *      那一格，只测总量的话它形同虚设；
 *   3) 基线缺 `byModule` ⇒ 跳过按模块比较（否则首次接线会把存量全判成上涨）。
 */
import { describe, expect, it } from 'vitest'

import { compare } from '../ratchet.mjs'

const BASE = {
  totalDead: 10,
  totalRedundantExport: 20,
  byModule: { 'frontend/src/types': 5, 'backend/src/modules': 2 },
}

describe('dead-code 棘轮 — 基线只许下降或持平', () => {
  it('@guard-red-sample totalDead 上涨 ⇒ 必报', () => {
    const bad = compare({ ...BASE, totalDead: 11 }, BASE)
    expect(bad).toHaveLength(1)
    expect(bad[0]).toContain('totalDead 上涨')
  })

  it('@guard-red-sample 按模块上涨 ⇒ 必报（总量持平也抓得住）', () => {
    const bad = compare(
      { totalDead: 10, totalRedundantExport: 20, byModule: { 'frontend/src/types': 6 } },
      BASE
    )
    expect(bad).toHaveLength(1)
    expect(bad[0]).toContain('frontend/src/types 死物上涨')
  })

  it('@guard-red-sample 新模块出现死物 ⇒ 必报（基线里没有 = 0）', () => {
    const bad = compare({ ...BASE, byModule: { ...BASE.byModule, 'frontend/src/new': 3 } }, BASE)
    expect(bad).toHaveLength(1)
    expect(bad[0]).toContain('frontend/src/new 死物上涨：0 → 3')
  })

  it('持平 / 下降 ⇒ 不报', () => {
    expect(compare(BASE, BASE)).toEqual([])
    expect(
      compare(
        { totalDead: 9, totalRedundantExport: 18, byModule: { 'frontend/src/types': 4 } },
        BASE
      )
    ).toEqual([])
  })

  it('基线无 byModule ⇒ 跳过按模块比较（不把存量判成上涨）', () => {
    const noMod = { totalDead: 10, totalRedundantExport: 20 }
    expect(
      compare({ totalDead: 10, totalRedundantExport: 20, byModule: { 'a/b': 99 } }, noMod)
    ).toEqual([])
  })
})

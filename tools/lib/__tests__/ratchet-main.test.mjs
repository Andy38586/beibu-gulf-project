import { describe, expect, it } from 'vitest'

import { baselineSelfConflict } from '../ratchet-main.mjs'

/** Q26：基线自洽。红样是“基线被改小 1 / 分组求和不等”，绿样是当前三条真实基线的形状。 */
describe('baselineSelfConflict（Q26）', () => {
  const spec = { metric: 'total', items: 'items', byGroup: 'byGroup' }

  it('自洽基线 ⇒ 无 error 无 warning', () => {
    const b = { total: 2, items: [{}, {}], byGroup: { a: 1, b: 1 } }
    expect(baselineSelfConflict(b, spec)).toEqual({ errors: [], warnings: [] })
  })

  it('total ≠ items.length ⇒ error（红样）', () => {
    const b = { total: 3, items: [{}, {}], byGroup: { a: 1, b: 1 } }
    expect(baselineSelfConflict(b, spec).errors[0]).toContain('items.length')
  })

  it('total ≠ ΣbyGroup ⇒ error（红样）', () => {
    const b = { total: 2, items: [{}, {}], byGroup: { a: 1 } }
    expect(baselineSelfConflict(b, spec).errors[0]).toContain('ΣbyGroup')
  })

  it('老格式缺 items ⇒ 明确 warning（不静默）', () => {
    const b = { total: 2, byGroup: { a: 2 } }
    const r = baselineSelfConflict(b, spec)
    expect(r.errors).toEqual([])
    expect(r.warnings[0]).toContain('老格式')
  })

  it('dup 口径：totalRedundantTokens ≠ ΣbyModule ⇒ error', () => {
    const dupSpec = {
      metric: 'totalGroups',
      items: 'groups',
      tokenMetric: 'totalRedundantTokens',
      byModule: 'byModule',
    }
    const b = { totalGroups: 1, groups: [{}], totalRedundantTokens: 10, byModule: { a: 9 } }
    expect(baselineSelfConflict(b, dupSpec).errors[0]).toContain('totalRedundantTokens')
  })
})

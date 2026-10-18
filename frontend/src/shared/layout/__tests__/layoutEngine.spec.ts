import { describe, expect, it } from 'vitest'

import { PANEL_SPACING, SAFE_MARGIN } from '../config'
import { LayoutOverflowError, computeLayout, findOverlaps, layoutModeFor } from '../layoutEngine'
import { definePanels, type PanelSpec } from '../panelRegistry'

// 现模板形态复刻：每列两个 4×4（offset-y=1.25/5.5 在 cell=80 时即堆叠 120/460），
// 1320×800 为常见笔记本预算（cell=80，标题行 1 格 + 上下 SAFE_MARGIN）。
const typical: PanelSpec[] = definePanels([
  { id: 'l1', title: 'L1', zone: 'left', order: 1, w: 4, h: 4, priority: 1 },
  { id: 'l2', title: 'L2', zone: 'left', order: 2, w: 4, h: 4, priority: 2 },
  { id: 'r1', title: 'R1', zone: 'right', order: 1, w: 4, h: 4, priority: 1 },
  { id: 'r2', title: 'R2', zone: 'right', order: 2, w: 4, h: 4, priority: 2 },
])

describe('布局注册表与引擎（事实单源）', () => {
  it('非法尺寸注册期拒绝（1.25 之类非 0.5 倍数即抛）——经 definePanels 公开面', () => {
    const spec = (w: number, h: number): PanelSpec => ({
      id: 'demo',
      title: 'D',
      zone: 'left',
      order: 1,
      w,
      h,
      priority: 1,
    })
    expect(() => definePanels([spec(1.25, 4)])).toThrow()
    expect(() => definePanels([spec(4, 4.3)])).toThrow()
    expect(() => definePanels([spec(5.5, 4)])).not.toThrow()
    expect(() => definePanels([spec(4, 4)])).not.toThrow()
    expect(() =>
      definePanels([
        { id: 'dup', title: 'D', zone: 'left', order: 1, w: 4, h: 4, priority: 1 },
        { id: 'dup', title: 'D2', zone: 'left', order: 2, w: 4, h: 4, priority: 1 },
      ])
    ).toThrow()
  })

  it('1320×800 下两列两面板：零重叠 + 不溢出 + 不越界（strict）', () => {
    const layout = computeLayout(typical, { width: 1320, height: 800 }, 'desktop', {
      strict: true,
    })
    expect(findOverlaps(layout.rects)).toEqual([])
    expect(layout.overflow).toEqual([])
    for (const r of layout.rects) {
      expect(r.x).toBeGreaterThanOrEqual(SAFE_MARGIN)
      expect(r.x + r.w).toBeLessThanOrEqual(1320 - SAFE_MARGIN)
      expect(r.y + r.h).toBeLessThanOrEqual(800 - SAFE_MARGIN)
    }
  })

  it('堆叠间距 = PANEL_SPACING（删堆叠即红：第二面板顶边须 = 第一面板底 + 间距）', () => {
    const layout = computeLayout(typical, { width: 1320, height: 800 }, 'desktop')
    const left = layout.rects.filter((r) => r.zone === 'left').sort((a, b) => a.y - b.y)
    expect(left).toHaveLength(2)
    expect(left[1].y - (left[0].y + left[0].h)).toBe(PANEL_SPACING)
    expect(left[0].x).toBe(SAFE_MARGIN)
  })

  it('纵向溢出 strict 抛 LayoutOverflowError，非 strict 给 overflow 清单', () => {
    expect(() =>
      computeLayout(typical, { width: 1320, height: 500 }, 'desktop', { strict: true })
    ).toThrow(LayoutOverflowError)
    const relaxed = computeLayout(typical, { width: 1320, height: 500 }, 'desktop')
    expect(relaxed.overflow.length).toBeGreaterThan(0)
  })

  it('findOverlaps 阳性对照：手造重叠矩形必命中（判据非恒绿）', () => {
    const pairs = findOverlaps([
      { id: 'a', x: 20, y: 120, w: 320, h: 320, zone: 'left', collapsed: false },
      { id: 'b', x: 100, y: 200, w: 320, h: 320, zone: 'left', collapsed: false },
    ])
    expect(pairs).toEqual([['a', 'b']])
    expect(
      findOverlaps([
        { id: 'a', x: 20, y: 120, w: 320, h: 320, zone: 'left', collapsed: false },
        { id: 'b', x: 400, y: 120, w: 320, h: 320, zone: 'right', collapsed: false },
      ])
    ).toEqual([])
  })

  it('档位派生：紧凑档只留 priority=1，抽屉档全量按 priority 排序', () => {
    expect(layoutModeFor(1320)).toBe('desktop')
    const compact = computeLayout(typical, { width: 500, height: 900 }, 'compact')
    expect(compact.rects.map((r) => r.id).sort()).toEqual(['l1', 'r1'])
    const drawer = computeLayout(typical, { width: 800, height: 900 }, 'drawer')
    expect(drawer.rects).toHaveLength(typical.length)
  })
})
// D3 去 export：assertCellMultiple 已收为模块内部；本组是「公开面收窄」本身的判据。
describe('公开面收窄 — assertCellMultiple 不得再导出', () => {
  const INTERNAL = ['assertCellMultiple']

  it('内部符号不在模块公开面；公开符号仍在（阳性对照）', async () => {
    const mod = (await import('../panelRegistry')) as unknown as Record<string, unknown>
    for (const k of INTERNAL) expect(mod[k], k + ' 应已收为模块内部').toBeUndefined()
    expect(typeof mod.definePanels).toBe('function')
  })
})

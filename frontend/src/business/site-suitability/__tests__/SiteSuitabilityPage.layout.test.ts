// 本页派生位置双判据：①注册表在 1320×800 strict 下零重叠不溢出不越界；
// ②派生值在 cell=80 时等于旧模板字面量（像素零变化），cell=70 时贴标题行。
import { describe, expect, it } from 'vitest'

import { computeLayout, findOverlaps, placementsFor, SAFE_MARGIN } from '@/shared'

import { SITE_SUITABILITY_PANELS } from '../panels'

describe('SiteSuitabilityPage 布局派生', () => {
  it('1320×800 strict：零重叠 + 不溢出 + 不越界', () => {
    const layout = computeLayout(SITE_SUITABILITY_PANELS, { width: 1320, height: 800 }, 'desktop', {
      strict: true,
    })
    expect(layout.overflow).toEqual([])
    expect(findOverlaps(layout.rects)).toEqual([])
    for (const r of layout.rects) {
      expect(r.x).toBeGreaterThanOrEqual(SAFE_MARGIN)
      expect(r.x + r.w).toBeLessThanOrEqual(1320 - SAFE_MARGIN)
      expect(r.y + r.h).toBeLessThanOrEqual(800 - SAFE_MARGIN)
    }
  })

  it('cell=80 派生值等于旧字面量 1.25/5.5（像素零变化）', () => {
    expect(placementsFor(SITE_SUITABILITY_PANELS, 80)).toEqual({
      radar: { w: 4, h: 4, anchor: 'top-left', offsetX: 0, offsetY: 1.25 },
      candidates: { w: 4, h: 4, anchor: 'top-left', offsetX: 0, offsetY: 5.5 },
      control: { w: 4, h: 4, anchor: 'top-right', offsetX: 0, offsetY: 1.25 },
      layers: { w: 4, h: 4, anchor: 'top-right', offsetX: 0, offsetY: 5.5 },
    })
  })

  it('cell=70 首面板顶边贴标题行底（旧字面量差 2.5px 即红）', () => {
    const first = placementsFor(SITE_SUITABILITY_PANELS, 70).radar
    expect(20 + first.offsetY * 70).toBeCloseTo(110)
  })
})

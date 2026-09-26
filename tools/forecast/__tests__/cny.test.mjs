import { describe, expect, it } from 'vitest'

import cny from '../lib/cny.cjs'

const { CNY_WINDOWS, buildCnyContext, holidayDaysInMonth, daysInMonth } = cny

// 春节移动假期修正单测（2026-09-26 F2）：窗口表、调整/逆变换互逆、确定性（04-B10）

describe('假期窗口表 holidayDaysInMonth', () => {
  it('2025（窗口 01-28 起 8 天）：1 月 4 天、2 月 4 天', () => {
    expect(holidayDaysInMonth('2025-01')).toBe(4)
    expect(holidayDaysInMonth('2025-02')).toBe(4)
  })

  it('2024（窗口 02-10 起 8 天，闰年 2 月 29 天）：1 月 0、2 月 8', () => {
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(holidayDaysInMonth('2024-01')).toBe(0)
    expect(holidayDaysInMonth('2024-02')).toBe(8)
  })

  it('2023（窗口 01-21 起 7 天）：1 月 7、2 月 0', () => {
    expect(holidayDaysInMonth('2023-01')).toBe(7)
    expect(holidayDaysInMonth('2023-02')).toBe(0)
  })

  it('2026 窗口全部落在 2 月；非 1/2 月恒 0；表外年份恒 0', () => {
    expect(holidayDaysInMonth('2026-01')).toBe(0)
    expect(holidayDaysInMonth('2026-02')).toBe(8)
    expect(holidayDaysInMonth('2025-06')).toBe(0)
    expect(holidayDaysInMonth('2037-02')).toBe(0)
  })

  it('窗口表覆盖 2021-2036（预测期 2035-12 内全程可逆变换）', () => {
    for (let y = 2021; y <= 2036; y++) {
      expect(CNY_WINDOWS[y]).toBeDefined()
    }
  })
})

describe('buildCnyContext 调整与逆变换', () => {
  // 2021-2026 全部月份样本：h̄_jan = (0+1+7+0+4+0)/6 = 2，h̄_feb = (7+6+0+8+4+8)/6 = 5.5
  function fullSample() {
    const times = []
    for (let y = 2021; y <= 2026; y++) {
      for (let m = 1; m <= 12; m++) times.push(`${y}-${String(m).padStart(2, '0')}`)
    }
    return times
  }

  it('假期多的月份被上调（2024-02 factor >1），少的被下调（2023-02 factor <1）', () => {
    const ctx = buildCnyContext(fullSample())
    const feb24 = ctx.adjustValue('2024-02', 100)
    const feb23 = ctx.adjustValue('2023-02', 100)
    // 2024-02: (29−5.5)/(29−8) = 23.5/21 ≈ 1.119
    expect(feb24).toBeGreaterThan(100)
    // 2023-02: (28−5.5)/(28−0) = 22.5/28 ≈ 0.804
    expect(feb23).toBeLessThan(100)
    expect(Math.abs(feb24 / 100 - 23.5 / 21)).toBeLessThan(1e-9)
  })

  it('非 1/2 月因子恒等于 1', () => {
    const ctx = buildCnyContext(fullSample())
    expect(ctx.adjustValue('2025-06', 123.45)).toBeCloseTo(123.45, 12)
    expect(ctx.invertValue('2025-06', 123.45)).toBeCloseTo(123.45, 12)
  })

  it('adjust ∘ invert = 恒等（历史逐点互逆）', () => {
    const ctx = buildCnyContext(fullSample())
    for (const t of fullSample()) {
      const v = 100 + Math.sin(t.length) * 7
      expect(ctx.invertValue(t, ctx.adjustValue(t, v))).toBeCloseTo(v, 9)
    }
  })

  it('预测期逆变换用目标年日历（2031-01 假期 8 天：factor = 23/29）', () => {
    const ctx = buildCnyContext(fullSample())
    // h̄_jan = 2 → (31−8)/(31−2) = 23/29
    expect(ctx.invertValue('2031-01', 100)).toBeCloseTo((23 / 29) * 100, 9)
  })

  it('k 参数生效：k=1 时全因子退化为 1（假期日完全保留活动）', () => {
    const ctx = buildCnyContext(fullSample(), { k: 1 })
    for (const t of fullSample()) {
      expect(ctx.adjustValue(t, 50)).toBeCloseTo(50, 12)
    }
  })
})

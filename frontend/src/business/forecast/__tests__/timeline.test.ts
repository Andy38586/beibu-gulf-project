import { describe, expect, it } from 'vitest'

import { BASE_YEAR, END_YEAR } from '@/shared'

import { currentTimeToStep, monthMaxSteps, stepToTime, yearMaxSteps } from '../timeline'

// 预测时间轴换算守卫（审查 H-3 回归）：年/月双粒度共用步长索引，年模式产出的
// 无月份串切回月模式时不得产生 NaN（曾穿透播放守卫死循环写 "NaN-NaN"）。

describe('currentTimeToStep — 年月双基换算', () => {
  it('年模式读年串 → 年步', () => {
    expect(currentTimeToStep('2025', true)).toBe(2025 - BASE_YEAR)
  })

  it('月模式读月串 → 月步（2025-06 = 4 年 × 12 + 5）', () => {
    expect(currentTimeToStep('2025-06', false)).toBe((2025 - BASE_YEAR) * 12 + 5)
  })

  it('年串切月模式 → m 缺省按 1 月计，不产生 NaN（H-3 回归）', () => {
    const step = currentTimeToStep('2025', false)
    expect(Number.isFinite(step)).toBe(true)
    expect(step).toBe((2025 - BASE_YEAR) * 12)
    expect(stepToTime(step, false)).toBe('2025-01')
  })

  it('月串切年模式 → 取年份步（月份信息自然丢弃）', () => {
    expect(currentTimeToStep('2025-06', true)).toBe(2025 - BASE_YEAR)
  })
})

describe('stepToTime — 步转时间串', () => {
  it('年模式产出无月份串', () => {
    expect(stepToTime(0, true)).toBe(String(BASE_YEAR))
    expect(stepToTime(END_YEAR - BASE_YEAR, true)).toBe(String(END_YEAR))
  })

  it('月模式产出补零月串，12 月跨年闭合', () => {
    expect(stepToTime(0, false)).toBe(`${BASE_YEAR}-01`)
    expect(stepToTime(11, false)).toBe(`${BASE_YEAR}-12`)
    expect(stepToTime(monthMaxSteps(), false)).toBe(`${END_YEAR}-12`)
  })
})

describe('步数上限', () => {
  it('年模式 = 年数；月模式 = 12×年数-1（2031-12 闭合）', () => {
    expect(yearMaxSteps()).toBe(END_YEAR - BASE_YEAR)
    expect(monthMaxSteps()).toBe((END_YEAR - BASE_YEAR) * 12 + 11)
  })
})

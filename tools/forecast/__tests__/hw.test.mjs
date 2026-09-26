import { describe, expect, it } from 'vitest'

import hw from '../lib/hw.cjs'

const { DEFAULT_GRID, fitWithParams, fitHoltWinters, forecastFromFit, aicc } = hw

// Holt-Winters 阻尼模型单测（2026-09-26 F2）：确定性、可复算（04-B10）
// 夹具与生产输入取不同构造（合成规则序列），不与真实数据同值

/** 加性合成序列：y = 100 + 1.2t + 10·sin(2πm/12)，48 个月，2021-01 起 */
function additiveFixture(months = 48) {
  const values = []
  for (let i = 0; i < months; i++) {
    const m = (i % 12) + 1
    values.push(100 + i * 1.2 + 10 * Math.sin((2 * Math.PI * m) / 12))
  }
  return values
}

describe('fitHoltWinters 基础行为', () => {
  it('48 个月加性序列可拟合且单步拟合误差 <10%', () => {
    const values = additiveFixture()
    const fit = fitHoltWinters(values)
    expect(fit).not.toBeNull()
    expect(Number.isFinite(fit.aicc)).toBe(true)
    // 用同参重放取 fitted 序列，与真值比对（尾部一个周期）
    const refit = fitWithParams(values, 12, fit.params, fit.seasonalType)
    expect(refit).not.toBeNull()
    const actualTail = values.slice(-12)
    const fittedTail = refit.fitted.slice(-12)
    for (let i = 0; i < 12; i++) {
      expect(Math.abs(fittedTail[i] - actualTail[i]) / actualTail[i]).toBeLessThan(0.1)
    }
  })

  it('预测延续趋势与季节（h=12 与真值生成公式偏差 <10%）', () => {
    const values = additiveFixture()
    const fit = fitHoltWinters(values)
    const fc = forecastFromFit(fit, 12)
    expect(fc).toHaveLength(12)
    for (let i = 0; i < 12; i++) {
      const t = 48 + i
      const m = (t % 12) + 1
      const expected = 100 + t * 1.2 + 10 * Math.sin((2 * Math.PI * m) / 12)
      expect(Math.abs(fc[i] - expected) / expected).toBeLessThan(0.1)
    }
  })

  it('同输入两次运行输出逐字一致（确定性，禁随机）', () => {
    const values = additiveFixture()
    const a = JSON.stringify(fitHoltWinters(values))
    const b = JSON.stringify(fitHoltWinters(values))
    expect(a).toBe(b)
  })

  it('序列含 ≤0 值时只允许加性季节（乘性除法无定义）', () => {
    const values = additiveFixture().map((v, i) => (i === 5 ? 0 : v))
    const fit = fitHoltWinters(values)
    expect(fit).not.toBeNull()
    expect(fit.seasonalType).toBe('additive')
  })

  it('数据不足（n < 2m）返回 null，调用方降级基线', () => {
    expect(fitHoltWinters(additiveFixture(12))).toBeNull()
  })
})

describe('阻尼趋势（φ<1）长期外推收敛', () => {
  it('φ=0.9 时年增量单调衰减（外推不发散）', () => {
    const values = additiveFixture()
    const fit = fitWithParams(
      values,
      12,
      { alpha: 0.2, beta: 0.05, gamma: 0.1, phi: 0.9 },
      'additive'
    )
    expect(fit).not.toBeNull()
    const fc = forecastFromFit(fit, 108)
    const incEarly = fc[23] - fc[11] // 第 12→24 步增量
    const incLate = fc[107] - fc[95] // 第 96→108 步增量
    expect(incLate).toBeLessThan(incEarly)
  })
})

describe('乘性与 AICc', () => {
  it('乘性序列（正值、比例季节）可拟合且预测继续增长', () => {
    const values = []
    for (let i = 0; i < 48; i++) {
      const m = (i % 12) + 1
      values.push(500 * Math.pow(1.005, i) * (1 + 0.2 * Math.sin((2 * Math.PI * m) / 12)))
    }
    const fit = fitHoltWinters(values)
    expect(fit).not.toBeNull()
    const fc = forecastFromFit(fit, 6)
    const lastFitted = fit.states.l + fit.states.b
    expect(fc[5]).toBeGreaterThan(lastFitted * 0.98)
  })

  it('AICc：SSE 非正或 n≤k+1 时返回 +Inf（组合被淘汰）', () => {
    expect(aicc(0, 36, 16)).toBe(Number.POSITIVE_INFINITY)
    expect(aicc(10, 16, 16)).toBe(Number.POSITIVE_INFINITY)
    expect(Number.isFinite(aicc(10, 36, 16))).toBe(true)
  })

  it('网格含 φ=1.0（无阻尼）与多个阻尼档（口径可复算）', () => {
    expect(DEFAULT_GRID.phi).toContain(1.0)
    expect(DEFAULT_GRID.phi.length).toBeGreaterThanOrEqual(5)
  })
})

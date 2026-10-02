import { describe, expect, it } from 'vitest'

import { dieboldMariano, dmFromSeries, normalTwoSidedP } from '../lib/evaluate.cjs'

// L5 评估统计单测（2026-10-02）：DM 检验的金值用手工可复算夹具（非实现复写），
// HAC Bartlett 权重/erf 近似各有独立判据——变异四式见提交正文。

describe('normalTwoSidedP（正态近似）', () => {
  it('z=0 → p=1；z=1.96 → p≈0.05；z=3 → p≈0.0027（A&S 7.1.26 精度内）', () => {
    expect(normalTwoSidedP(0)).toBeCloseTo(1, 6) // x=0 处 Horner 求和舍入 ~1e-9，A&S 精度量级
    expect(Math.abs(normalTwoSidedP(1.96) - 0.05)).toBeLessThan(0.001)
    expect(Math.abs(normalTwoSidedP(3) - 0.0027)).toBeLessThan(0.0005)
  })
})

describe('dieboldMariano（平方损失差，HAC Newey-West）', () => {
  it('金值（手算）：d=[1,2,3,4]、horizon=2 → q=1、w1=0.5、V=1.5625、DM=4.0、p≈6.3e-5', () => {
    // dbar=2.5；γ0=(2.25+0.25+0.25+2.25)/4=1.25；γ1=(0.75−0.25+0.75)/4=0.3125
    // V = 1.25 + 2×0.5×0.3125 = 1.5625；DM = 2.5/√(1.5625/4) = 2.5/0.625 = 4.0
    const r = dieboldMariano([1, 2, 3, 4], [0, 0, 0, 0], 2)
    expect(r.dm).toBe(4)
    expect(r.p).toBeLessThan(0.001)
  })

  it('horizon=1（无自相关项）：d=[1,2,3] → V=γ0=2/3，DM=2/√((2/3)/3)=4.2426', () => {
    const r = dieboldMariano([1, 2, 3], [0, 0, 0], 1)
    expect(r.dm).toBeCloseTo(4.2426, 3)
  })

  it('两模型损失全同 → DM=0、p=1（等价重构不得红）', () => {
    const r = dieboldMariano([1, 2, 3, 4], [1, 2, 3, 4], 12)
    expect(r.dm).toBe(0)
    expect(r.p).toBe(1)
  })

  it('A 恒优于 B → |DM|>1.96 显著；样本 <3 或恒差零方差 → null（不算显著）', () => {
    const lossA = Array.from({ length: 50 }, (_, i) => 1 + i * 0.01)
    const lossB = Array.from({ length: 50 }, (_, i) => 2 + i * 0.01)
    const sig = dieboldMariano(lossA, lossB, 12)
    expect(Math.abs(sig.dm)).toBeGreaterThan(1.96)
    expect(sig.p).toBeLessThan(0.05)
    expect(dieboldMariano([1, 2], [0, 0], 12).dm).toBeNull()
    // d 恒 1（方差 0、差异非零）→ 方差无定义，不算显著
    expect(dieboldMariano([2, 2, 2], [1, 1, 1], 12).dm).toBeNull()
  })
})

describe('dmFromSeries（series 按 time 对齐取交集）', () => {
  const s = (time, actual, predicted) => ({ time, step: 1, actual, predicted })

  it('交集对齐：B 缺一个时点 → n 只数交集（≥3 才检验）；值正确', () => {
    const a = [
      s('2025-01', 100, 110),
      s('2025-02', 100, 120),
      s('2025-03', 100, 130),
      s('2025-04', 100, 140),
    ]
    const b = [
      s('2025-01', 100, 100),
      s('2025-02', 100, 102),
      s('2025-03', 100, 104),
      s('2025-05', 100, 0), // 04 缺失 → 交集 4 点里它不算
    ]
    const r = dmFromSeries(a, b, 1)
    expect(r.n).toBe(3) // 交集 = {01,02,03}；a 的 04 与 b 的 05 互斥不计
    // 交集：lossA = [100,400,900]，lossB = [0,4,16] → A 显著更差
    expect(Math.abs(r.dm)).toBeGreaterThan(1.96)
  })
})

import { describe, expect, it } from 'vitest'

import { ahpWeights, CR_THRESHOLD, RI_TABLE } from '../src/common/ahp'
import { SITE_AHP_DRAFT_MATRIX } from '../src/common/constants/site-ahp.constants'

// AHP 纯函数单测（工单 §四单元三）。oracle 用 Saaty 教科书已发表算例，
// 不从实现反推期望值（对齐 scenario.service.spec 的手工复算纪律）。

describe('ahpWeights 一致矩阵（阳性）', () => {
  it('从精确比值矩阵恢复权重到 1e-9（CR≈0）', () => {
    const w = [0.1, 0.15, 0.2, 0.25, 0.3]
    const m = w.map((wi) => w.map((wj) => wi / wj))
    const r = ahpWeights(m)
    r.weights.forEach((v, i) => expect(Math.abs(v - w[i])).toBeLessThan(1e-9))
    expect(r.cr).toBeLessThan(1e-9)
    expect(Math.abs(r.lambdaMax - 5)).toBeLessThan(1e-6)
  })

  it('n=2 矩阵恒一致（RI=0，CR 记 0）', () => {
    const r = ahpWeights([
      [1, 7],
      [1 / 7, 1],
    ])
    expect(r.cr).toBe(0)
    expect(r.weights[0]).toBeCloseTo(7 / 8, 12)
  })
})

describe('ahpWeights Saaty 已发表算例（独立 oracle）', () => {
  it('3×3 经典算例：权重 0.637/0.258/0.105，λmax=3.0385，CR≈0.033', () => {
    const r = ahpWeights([
      [1, 3, 5],
      [1 / 3, 1, 3],
      [1 / 5, 1 / 3, 1],
    ])
    expect(r.weights[0]).toBeCloseTo(0.637, 2)
    expect(r.weights[1]).toBeCloseTo(0.258, 2)
    expect(r.weights[2]).toBeCloseTo(0.105, 2)
    expect(r.lambdaMax).toBeCloseTo(3.0385, 3)
    expect(r.cr).toBeCloseTo(0.0332, 3)
    expect(r.cr).toBeLessThan(CR_THRESHOLD)
  })
})

describe('ahpWeights 拒收（阴性）', () => {
  it('循环不一致矩阵 CR≈0.319 ≥ 0.1 → 拒收抛错', () => {
    // a12=9, a23=9, a13=1/9 构成偏好环：λmax≈3.37
    expect(() =>
      ahpWeights([
        [1, 9, 1 / 9],
        [1 / 9, 1, 9],
        [9, 1 / 9, 1],
      ])
    ).toThrow(/一致性检验不过/)
  })

  it('互反性破坏/非方阵/非正数/对角非 1 全部显式抛错', () => {
    expect(() =>
      ahpWeights([
        [1, 2],
        [1 / 3, 1],
      ])
    ).toThrow(/互反性/)
    // 互反性微偏离（乘积偏差 5e-8）仍须拒收——把容差 1e-9 判据钉死，
    // 防实现放宽容差而测试仍绿（假绿壳）
    expect(() =>
      ahpWeights([
        [1, 2],
        [1 / 2.0000001, 1],
      ])
    ).toThrow(/互反性/)
    expect(() => ahpWeights([[1, 2, 3]])).toThrow(/非方阵/)
    expect(() =>
      ahpWeights([
        [1, 0],
        [0, 1],
      ])
    ).toThrow(/非正数/)
    expect(() =>
      ahpWeights([
        [2, 1],
        [1, 1],
      ])
    ).toThrow(/对角元/)
  })
})

describe('草案判断矩阵（constants/site-ahp）', () => {
  it('SITE_AHP_DRAFT_MATRIX 通过一致性检验且和为 1（草案可用的门槛）', () => {
    const r = ahpWeights(SITE_AHP_DRAFT_MATRIX)
    expect(r.cr).toBeLessThan(CR_THRESHOLD)
    const sum = r.weights.reduce((a, b) => a + b, 0)
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9)
    // 权重序可观测：浸没风险居首（安全门槛型判据），与草案逐格依据的定性叙述一致
    expect(r.weights[0]).toBe(Math.max(...r.weights))
  })

  it('RI 表自洽：n=3..15 单调不减且 n=1,2 为 0', () => {
    expect(RI_TABLE[1]).toBe(0)
    expect(RI_TABLE[2]).toBe(0)
    for (let n = 3; n < 15; n++) expect(RI_TABLE[n]).toBeLessThanOrEqual(RI_TABLE[n + 1]!)
  })
})

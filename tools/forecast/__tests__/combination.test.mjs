import { describe, expect, it } from 'vitest'

import { combinationWeights, combinePredictions, createWeightTracker } from '../lib/combination.cjs'

// L3 组合预测单测（2026-10-02）：权重归一/剔除重归一/因果因果性/金值组合——
// 变异四式见提交正文（去归一红、反比写成正比红、等权兜底删红）。

describe('combinationWeights', () => {
  it('inverse：权重 ∝ 1/score 且和为 1（手算：1/2 与 1/4 → 2/3 与 1/3）', () => {
    const w = combinationWeights({ a: 2, b: 4 }, 'inverse')
    expect(w.a).toBeCloseTo(2 / 3, 12)
    expect(w.b).toBeCloseTo(1 / 3, 12)
  })

  it('非有限/非正分数剔除，余下重归一；全剔除等权兜底（等权兜底删红）', () => {
    const w = combinationWeights({ a: 2, b: 0, c: -1, d: Number.NaN }, 'inverse')
    expect(Object.keys(w).sort()).toEqual(['a'])
    expect(w.a).toBe(1)
    const all = combinationWeights({ a: 0, b: -1 }, 'inverse')
    expect(all.a).toBeCloseTo(all.b, 12)
  })

  it('mean：参与模型等权；score 形状只取键集', () => {
    const w = combinationWeights({ a: 1, b: 100 }, 'mean')
    expect(w.a).toBe(0.5)
    expect(w.b).toBe(0.5)
  })
})

describe('combinePredictions（金值）', () => {
  it('权重组合精确：100×0.25 + 110×0.75 = 107.5', () => {
    const v = combinePredictions(
      [
        { key: 'a', value: 100 },
        { key: 'b', value: 110 },
      ],
      { a: 0.25, b: 0.75 }
    )
    expect(v).toBeCloseTo(107.5, 12)
  })

  it('某模型预测无效 → 其权重并入余下模型重归一（不是丢弃质量）', () => {
    const v = combinePredictions(
      [
        { key: 'a', value: 100 },
        { key: 'b', value: null },
      ],
      { a: 0.25, b: 0.75 }
    )
    expect(v).toBeCloseTo(100, 12) // a 权重重归一为 1
  })

  it('全部无效 → null（该时点无组合预测，回测按无样本跳过）', () => {
    expect(combinePredictions([{ key: 'a', value: null }], { a: 1 })).toBeNull()
  })
})

describe('createWeightTracker（因果性=防泄漏核心）', () => {
  it('未喂入 → weights()=null（调用方走等权）；喂入后只反映已实现快照', () => {
    const t = createWeightTracker('inverse')
    expect(t.weights()).toBeNull()
    t.update({ linear: 6, ets: 9, seasonal_naive: 7 })
    const w = t.weights()
    expect(w.linear).toBeGreaterThan(w.ets) // 误差小 → 权重大
    expect(w.linear + w.ets + w.seasonal_naive).toBeCloseTo(1, 12)
  })

  it('更新快照整体替换：新 origin 的权重不含旧快照残留', () => {
    const t = createWeightTracker('inverse')
    t.update({ a: 1, b: 3 })
    t.update({ a: 3, b: 1 })
    const w = t.weights()
    expect(w.b).toBeGreaterThan(w.a) // 新快照里 b 更准
  })
})

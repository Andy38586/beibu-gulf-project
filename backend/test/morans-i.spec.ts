import { describe, expect, it } from 'vitest'

import { moransI } from '../src/common/morans-i'
import { seededRandom } from '../src/common/seeded-random'

// Moran's I 单测（W6-8 产业拟合）。oracle 全部手算独立复算（4 节点环图，
// 行标准化 w=0.5），不从实现反推。

/** n 节点环图行标准化权重（n≥4；每节点邻 i±1，各 w=0.5） */
function ring(n: number) {
  return Array.from({ length: n }, (_, i) => [
    { j: (i + 1) % n, w: 0.5 },
    { j: (i + n - 1) % n, w: 0.5 },
  ])
}

describe('moransI 公式（手算 oracle）', () => {
  it('交替值 [1,0,1,0] 环图：I = −1（完全负自相关）', () => {
    const r = moransI([1, 0, 1, 0], ring(4), { permutations: 0 })
    expect(r.i).toBeCloseTo(-1, 9)
  })

  it('半区值 [1,1,0,0] 环图：I = 0（正负抵消）', () => {
    const r = moransI([1, 1, 0, 0], ring(4), { permutations: 0 })
    expect(r.i).toBeCloseTo(0, 9)
  })

  it('单调梯度 [1,2,3,4] 环图：I = −0.2（手算 ΣΣwzz=−1, Σz²=5）', () => {
    const r = moransI([1, 2, 3, 4], ring(4), { permutations: 0 })
    expect(r.i).toBeCloseTo(-0.2, 9)
  })

  it('E[I] = −1/(n−1)', () => {
    const r = moransI([1, 2, 3, 4], ring(4), { permutations: 0 })
    expect(r.expectedI).toBeCloseTo(-1 / 3, 12)
  })
})

describe('moransI 拒收（阴性）', () => {
  it('方差为 0（全同值）无定义 → 抛错', () => {
    expect(() => moransI([2, 2, 2, 2], ring(4), { permutations: 0 })).toThrow(/方差为 0/)
  })
  it('样本数 <2 / 权重行数不符 / 邻接越界 → 显式抛错', () => {
    expect(() => moransI([1], ring(1), { permutations: 0 })).toThrow(/样本数/)
    expect(() => moransI([1, 2, 3], ring(4), { permutations: 0 })).toThrow(/权重行数/)
    expect(() =>
      moransI([1, 2], [[{ j: 5, w: 1 }], [{ j: 0, w: 1 }]], { permutations: 0 })
    ).toThrow(/越界/)
  })
})

describe('moransI 置换检验', () => {
  // 两个 4 节点团（团内行标准化 w=1/3），强空间聚集值
  const twoCliques = Array.from({ length: 8 }, (_, i) =>
    [0, 1, 2, 3].filter((d) => d !== i % 4).map((d) => ({ j: i < 4 ? d : d + 4, w: 1 / 3 }))
  )
  it('强聚集 [1×4,10×4]：I 高且 p < 0.05', () => {
    const r = moransI([1, 1, 1, 1, 10, 10, 10, 10], twoCliques, { permutations: 999 })
    expect(r.i).toBeGreaterThan(0.7)
    expect(r.pValue).toBeLessThan(0.05)
  })
  it('n=4 交替环：置换 p 可枚举真值 ≈ 1/3（6 种排布中 2 种交替，非稀有）', () => {
    const r = moransI([1, 0, 1, 0], ring(4), { permutations: 999 })
    expect(r.pValue).toBeGreaterThan(0.25)
    expect(r.pValue).toBeLessThan(0.42)
  })
  it('n=8 交替环 [1,0,…]：I = −1（环上完全反聚集恒为 −1），p ≈ 2/70 < 0.05', () => {
    const r = moransI([1, 0, 1, 0, 1, 0, 1, 0], ring(8), { permutations: 999 })
    expect(r.i).toBeCloseTo(-1, 9)
    // 真值 2/70≈0.029；区间钉死：上界排除普通排布（0.5+），下界排除"p 恒 0.001"的假实现
    expect(r.pValue).toBeGreaterThan(0.01)
    expect(r.pValue).toBeLessThan(0.06)
  })
  it('固定种子可复现：同输入同 seed 同 p；p 分辨率 = 1/(B+1)', () => {
    const a = moransI([1, 1, 1, 1, 10, 10, 10, 10], twoCliques, { permutations: 999, seed: 42 })
    const b = moransI([1, 1, 1, 1, 10, 10, 10, 10], twoCliques, { permutations: 999, seed: 42 })
    expect(a.pValue).toBe(b.pValue)
    const denom = 1 / (a.permutations + 1)
    expect((a.pValue / denom) % 1).toBe(0)
  })
  it('seededRandom 同种子同序列（Park-Miller 首值锚点）', () => {
    const r1 = seededRandom(7)
    const r2 = seededRandom(7)
    expect(r1()).toBe(r2())
    expect(r1()).toBe(r2())
  })
})

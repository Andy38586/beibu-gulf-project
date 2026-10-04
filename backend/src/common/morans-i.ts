// Moran's I 空间自相关纯函数（论文 W6-8 产业拟合指数；工单 §四 W6-8 行）。
// I = (n/S0)·(ΣΣ w_ij·z_i·z_j)/(Σ z_i²)，z = x − x̄；置换检验 p 值用固定种子 LCG
//（common/seeded-random 单一实现：业务数值禁 Math.random）。
// 只做数学不含业务语义；空间权重矩阵由调用方构造（knn/距离带皆可）。

import { seededRandom } from './seeded-random'

export type SpatialWeights = readonly (readonly { j: number; w: number }[])[]

export interface MoransIResult {
  /** Moran's I 观测值 */
  i: number
  /** 置换检验双侧 p 值 = (1 + #{|I_perm| ≥ |I_obs|}) / (B + 1) */
  pValue: number
  /** 置换次数（实际执行） */
  permutations: number
  /** 置换分布下的期望 E[I] = −1/(n−1)（参考值） */
  expectedI: number
  /** 观测样本数 */
  n: number
}

function moransIUncentered(
  values: readonly number[],
  weights: SpatialWeights
): { i: number; s0: number; sz2: number } {
  const n = values.length
  const mean = values.reduce((a, b) => a + b, 0) / n
  const z = values.map((v) => v - mean)
  const sz2 = z.reduce((a, v) => a + v * v, 0)
  if (sz2 <= 0) {
    throw new Error('方差为 0（所有值相同），Moran’s I 无定义')
  }
  let s0 = 0
  let cross = 0
  for (let i = 0; i < n; i++) {
    for (const { j, w } of weights[i]) {
      if (j < 0 || j >= n) throw new Error(`权重邻接下标越界：${j} ∉ [0,${n})`)
      s0 += w
      cross += w * z[i] * z[j]
    }
  }
  if (s0 <= 0) throw new Error('权重矩阵全零（无空间邻接）')
  return { i: (n / s0) * (cross / sz2), s0, sz2 }
}

/**
 * Moran's I + 置换检验。两侧 p 值；seed 固定保证同输入同 p（可缓存可复算）。
 * B 默认 999（p 分辨率 0.001）；n<2 拒收。
 */
export function moransI(
  values: readonly number[],
  weights: SpatialWeights,
  options: { permutations?: number; seed?: number } = {}
): MoransIResult {
  const n = values.length
  if (n < 2) throw new Error(`样本数须 ≥2（当前 ${n}）`)
  if (weights.length !== n) throw new Error(`权重行数 ${weights.length} ≠ 样本数 ${n}`)
  const observed = moransIUncentered(values, weights).i
  const permutations = options.permutations ?? 999
  const rng = seededRandom(options.seed ?? 20260927)
  let extreme = 0
  const perm = [...values]
  for (let b = 0; b < permutations; b++) {
    // Fisher-Yates 洗牌（从后向前，恒定消耗 rng 次数与顺序——置换分布可复现）
    for (let k = n - 1; k > 0; k--) {
      const r = rng()
      const m = Math.floor(r * (k + 1))
      const tmp = perm[k]
      perm[k] = perm[m]
      perm[m] = tmp
    }
    const ip = moransIUncentered(perm, weights).i
    if (Math.abs(ip) >= Math.abs(observed)) extreme++
  }
  return {
    i: observed,
    pValue: (extreme + 1) / (permutations + 1),
    permutations,
    expectedI: -1 / (n - 1),
    n,
  }
}

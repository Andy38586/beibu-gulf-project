// AHP 层次分析法纯函数库（Saaty 1980；论文主线工单 §四单元三）。
// 判断矩阵 → 特征向量法权重 → CR<0.1 一致性检验（不过检验直接拒收）。
// 只做数学，不含业务语义；准则层定义与判断矩阵草案在 constants/site-ahp.constants.ts。

interface AhpResult {
  /** 特征向量法权重（L1 归一化，Σ=1） */
  weights: number[]
  /** 最大特征值 λmax */
  lambdaMax: number
  /** 一致性指标 CI = (λmax − n)/(n − 1) */
  ci: number
  /** 一致性比率 CR = CI/RI；n≤2 时 RI=0、矩阵恒一致，CR 记 0 */
  cr: number
}

/** Saaty 随机一致性指标表（n=1..15），出处 Saaty 1980 §5.4（常用教科书通用值） */
export const RI_TABLE: readonly number[] = [
  0, 0, 0, 0.58, 0.9, 1.12, 1.24, 1.32, 1.41, 1.46, 1.49, 1.51, 1.54, 1.56, 1.57, 1.59,
]

export const CR_THRESHOLD = 0.1

/** 判断矩阵：只读二维方阵（互反阵） */
type JudgmentMatrix = readonly (readonly number[])[]

/** 判断矩阵合法性：方阵、全正、对角恒 1、互反性（a_ij·a_ji=1，容差 1e-9） */
function validateJudgmentMatrix(matrix: JudgmentMatrix): void {
  const n = matrix.length
  if (n < 1 || n > 15) {
    throw new Error(`判断矩阵阶数须在 1..15（当前 ${n}）`)
  }
  matrix.forEach((row, i) => {
    if (row.length !== n) {
      throw new Error(`判断矩阵第 ${i} 行长度 ${row.length} ≠ ${n}（非方阵）`)
    }
    row.forEach((a, j) => {
      if (!Number.isFinite(a) || a <= 0) {
        throw new Error(`判断矩阵[${i}][${j}] = ${a} 非正数`)
      }
      if (i === j) {
        if (Math.abs(a - 1) > 1e-9) throw new Error(`判断矩阵对角元[${i}][${i}] = ${a} ≠ 1`)
      } else if (Math.abs(a * matrix[j][i] - 1) > 1e-9) {
        throw new Error(
          `判断矩阵互反性破坏：[${i}][${j}]=${a} 与 [${j}][${i}]=${matrix[j][i]} 之积 ≠ 1`
        )
      }
    })
  })
}

/** 行主序方阵 × 向量（A·w）；幂迭代与 λmax 复算共用同一实现 */
function matVec(matrix: JudgmentMatrix, w: readonly number[]): number[] {
  return matrix.map((row) => row.reduce((s, a, j) => s + a * w[j], 0))
}

/** 幂迭代求主特征向量（正互反阵由 Perron-Frobenius 定理保证主特征值唯一且权重非负） */
function principalEigenvector(
  matrix: JudgmentMatrix,
  iterations = 1000,
  tolerance = 1e-12
): { weights: number[]; lambdaMax: number } {
  const n = matrix.length
  let w = new Array<number>(n).fill(1 / n)
  let lambdaMax = 1
  for (let k = 0; k < iterations; k++) {
    const raw = matVec(matrix, w)
    const sum = raw.reduce((a, b) => a + b, 0)
    if (sum <= 0) throw new Error('幂迭代出现非正列和（矩阵非法）')
    const next = raw.map((v) => v / sum)
    const diff = next.reduce((acc, v, i) => acc + Math.abs(v - w[i]), 0)
    w = next
    if (diff < tolerance) break
  }
  // λmax = (Aw)_i / w_i 的均值（幂迭代收敛处 w≈Aw/λmax）
  const aw = matVec(matrix, w)
  const lambdaSum = aw.reduce((acc, v, i) => acc + (w[i] > 0 ? v / w[i] : lambdaMax), 0)
  lambdaMax = lambdaSum / n
  return { weights: w, lambdaMax }
}

/**
 * AHP 主入口：校验 → 权重 → 一致性检验。CR ≥ 0.1 直接抛错（拒收），
 * 调用方不得吞错降级——不一致的权重会静默污染适宜性面（04-B8 口径）。
 */
export function ahpWeights(matrix: JudgmentMatrix): AhpResult {
  validateJudgmentMatrix(matrix)
  const n = matrix.length
  const { weights, lambdaMax } = principalEigenvector(matrix)
  const ci = n > 2 ? (lambdaMax - n) / (n - 1) : 0
  const ri = RI_TABLE[n] ?? 1.59
  const cr = ri > 0 ? ci / ri : 0
  if (cr >= CR_THRESHOLD) {
    throw new Error(
      `判断矩阵一致性检验不过：CR=${cr.toFixed(4)} ≥ ${CR_THRESHOLD}（λmax=${lambdaMax.toFixed(4)}，n=${n}），拒收`
    )
  }
  return { weights, lambdaMax, ci, cr }
}

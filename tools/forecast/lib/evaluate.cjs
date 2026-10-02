/**
 * 预测评估统计（L5）：Diebold-Mariano 模型差异检验。
 * （sMAPE / PICP 在 lib/backtest.cjs 内随回测累计，不在此处。）
 *
 * 论文价值：把"线性 6.25 vs ETS 9.14"从点估计数字升级为统计检验——
 * "两个模型精度差异是否显著"从此有 p 值可答（素材包答辩话术 1/2 的证据硬化）。
 */
'use strict'

/**
 * 标准正态双侧 p 值：p = 2(1 − Φ(|z|))。
 * Φ 用 Abramowitz & Stegun 7.1.26 erf 多项式近似（|误差| < 1.5e-7，本仓 z 值域内足够）。
 */
function normalTwoSidedP(z) {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x)
  return Math.max(0, Math.min(1, 2 * (1 - 0.5 * (1 + erf))))
}

/**
 * Diebold-Mariano 检验（Diebold & Mariano 1995；损失函数取平方误差——作者设定，
 * 平方损失下 DM 原文成立且对港口吞吐量量纲稳健）。
 *
 * d_t = L_A,t − L_B,t，H0: E[d_t] = 0。h 步 ahead 预测的损失差存在至多 h−1 阶自相关
 * ⇒ 方差用 HAC（Newey-West）：V = γ0 + 2 Σ_{k=1..q} w_k γk，q = h−1，Bartlett 核
 * w_k = 1 − k/(q+1) = 1 − k/h。DM = d̄ / sqrt(V/n)，p = 2(1−Φ(|DM|))（正态近似）。
 *
 * @param {number[]} lossA 模型 A 逐点损失（与 B 同序对齐）
 * @param {number[]} lossB 模型 B 逐点损失
 * @param {number} horizon 预测步长（定 HAC 截断 q = h−1）
 * @returns {{dm: number|null, p: number|null}} 样本 <3 或方差 ≤0 时判 null（无样本不算显著）
 */
function dieboldMariano(lossA, lossB, horizon) {
  const n = Math.min(lossA.length, lossB.length)
  if (n < 3) return { dm: null, p: null }
  const d = []
  for (let i = 0; i < n; i++) {
    const e = lossA[i] - lossB[i]
    if (Number.isFinite(e)) d.push(e)
  }
  const N = d.length
  if (N < 3) return { dm: null, p: null }
  const dbar = d.reduce((a, b) => a + b, 0) / N
  const centered = d.map((x) => x - dbar)
  const q = Math.max(0, Math.min(horizon - 1, N - 1))
  const gamma = (k) => {
    let g = 0
    for (let i = 0; i + k < N; i++) g += centered[i] * centered[i + k]
    return g / N
  }
  let v = gamma(0)
  for (let k = 1; k <= q; k++) v += 2 * (1 - k / (q + 1)) * gamma(k)
  if (!(v > 0)) {
    // 零方差：损失差恒 0 = 无可检差异（p=1，诚实语义）；恒非 0 = 方差无定义（不算显著）
    return dbar === 0 ? { dm: 0, p: 1 } : { dm: null, p: null }
  }
  const dm = dbar / Math.sqrt(v / N)
  return { dm: Math.round(dm * 10000) / 10000, p: Math.round(normalTwoSidedP(dm) * 10000) / 10000 }
}

/**
 * 由两模型回测 series 对齐算 DM（lib/backtest.cjs 的 series 逐点输出）。
 * 按 time 键取交集（两模型跳过的点不同——null 预测/真值缺失），损失 = 平方误差。
 */
function dmFromSeries(seriesA, seriesB, horizon) {
  const key = (s) => String(s.time)
  const bByKey = new Map(seriesB.map((s) => [key(s), s]))
  const lossA = []
  const lossB = []
  for (const a of seriesA) {
    const b = bByKey.get(key(a))
    if (!b) continue
    if (!Number.isFinite(a.actual) || !Number.isFinite(a.predicted)) continue
    if (!Number.isFinite(b.actual) || !Number.isFinite(b.predicted)) continue
    lossA.push((a.actual - a.predicted) ** 2)
    lossB.push((b.actual - b.predicted) ** 2)
  }
  const r = dieboldMariano(lossA, lossB, horizon)
  return { ...r, n: lossA.length }
}

module.exports = { dieboldMariano, dmFromSeries, normalTwoSidedP }

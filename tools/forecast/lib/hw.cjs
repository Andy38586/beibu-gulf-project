/**
 * Holt-Winters 三参数指数平滑（阻尼趋势，加性/乘性季节自动选择）——纯函数，零依赖，确定性。
 *
 * 用途（2026-09-26 算法升级）：作为 throughput_model.cjs 的候选模型，与线性基线同协议回测竞选。
 *   - 参数网格穷举（非优化器），同一输入永远同一输出（无随机数，禁 Math.random）
 *   - 阻尼系数 φ ∈ 网格：φ<1 时长期外推收敛（治线性外推 10 年发散），φ=1.0 退化为无阻尼（数据自己选）
 *   - 加性/乘性季节都跑，AICc 定胜负（n 与 k 两型相同，比较公平）
 *   - 序列含 ≤0 值时乘性不可用（除法无定义），自动只跑加性
 *
 * 口径（04-B10 可复算）：
 *   - 递推式（fpp3 口径）：l_t = α(y_t − s_{t−m}) + (1−α)(l_{t−1} + φ·b_{t−1})；
 *     b_t = β(l_t − l_{t−1}) + (1−β)·φ·b_{t−1}；s_t = γ·(残差项) + (1−γ)·s_{t−m}
 *   - AICc = n·ln(SSE/n) + 2k + 2k(k+1)/(n−k−1)，k = 4(α,β,γ,φ) + m(季节)，n = 单步拟合点数
 *   - 初始化：l₀ = 首季均值，b₀ = (次季均值 − 首季均值)/m，s 初值取首季对 l₀ 的偏差（归零/归一）
 *   - 预测：ŷ_{T+h} = (l_T + Σ_{i=1..h} φ^i · b_T) (+|×) s[(T+h−1) mod m]
 */
'use strict'

const DEFAULT_GRID = {
  alpha: [0.02, 0.05, 0.1, 0.2, 0.3, 0.5],
  beta: [0.001, 0.01, 0.05, 0.1, 0.3],
  gamma: [0.02, 0.05, 0.1, 0.2, 0.3],
  phi: [0.8, 0.85, 0.9, 0.95, 0.98, 1.0],
}

/**
 * 固定参数单次拟合（导出供测试与网格搜索复用）。
 * @returns {null | {params, seasonalType, sse, fittedCount, states:{l,b,s}}}
 *   values 长度 < 2m、乘性遇 ≤0 值、或递推产出非有限值时返回 null（该组合不可用）。
 */
function fitWithParams(values, m, params, seasonalType) {
  const n = values.length
  if (n < 2 * m) return null
  const { alpha, beta, gamma, phi } = params

  const season1 = values.slice(0, m)
  const season2 = values.slice(m, 2 * m)
  const mean1 = season1.reduce((a, b) => a + b, 0) / m
  const mean2 = season2.reduce((a, b) => a + b, 0) / m

  let l = mean1
  let b = (mean2 - mean1) / m
  let s = season1.map((v) => v - mean1)
  if (seasonalType === 'multiplicative') {
    if (!(mean1 > 0) || values.some((v) => v <= 0)) return null
    s = season1.map((v) => v / mean1)
    const sAvg = s.reduce((a, x) => a + x, 0) / m
    if (!(sAvg > 0)) return null
    s = s.map((x) => x / sAvg)
  } else {
    const sAvg = s.reduce((a, x) => a + x, 0) / m
    s = s.map((x) => x - sAvg)
  }

  let sse = 0
  const fitted = []
  for (let t = m; t < n; t++) {
    const sIdx = t % m // 季节状态按周期内位置存取——s[t-m] 在第一圈后会越界
    const sPrev = s[sIdx]
    const lPrev = l
    const bPrev = b
    const y = values[t]

    let forecast
    if (seasonalType === 'multiplicative') {
      if (!(sPrev > 0) || !(lPrev > 0)) return null
      forecast = (lPrev + phi * bPrev) * sPrev
    } else {
      forecast = lPrev + phi * bPrev + sPrev
    }
    const e = y - forecast
    sse += e * e
    if (!Number.isFinite(sse)) return null
    fitted.push(forecast)

    if (seasonalType === 'multiplicative') {
      if (!(sPrev > 0)) return null
      l = alpha * (y / sPrev) + (1 - alpha) * (lPrev + phi * bPrev)
    } else {
      l = alpha * (y - sPrev) + (1 - alpha) * (lPrev + phi * bPrev)
    }
    b = beta * (l - lPrev) + (1 - beta) * phi * bPrev
    if (!Number.isFinite(l) || !Number.isFinite(b)) return null

    const sNew =
      seasonalType === 'multiplicative'
        ? gamma * (y / l) + (1 - gamma) * sPrev
        : gamma * (y - l) + (1 - gamma) * sPrev
    if (seasonalType === 'multiplicative' && !(sNew > 0)) return null
    if (!Number.isFinite(sNew)) return null
    s[sIdx] = sNew
  }

  return { params, seasonalType, sse, fitted, m, states: { l, b, s: s.slice() } }
}

function aicc(sse, n, k) {
  if (!(sse > 0) || n <= k + 1) return Number.POSITIVE_INFINITY
  const aic = n * Math.log(sse / n) + 2 * k
  return aic + (2 * k * (k + 1)) / (n - k - 1)
}

/**
 * 网格搜索 + AICc 选型。
 * @returns {null | {params, seasonalType, aicc, sse, m, states, fittedCount}}
 *   全部组合不可用时返回 null（调用方降级基线）。
 */
function fitHoltWinters(values, { m = 12, grid = DEFAULT_GRID } = {}) {
  const n = values.length
  if (n < 2 * m) return null
  const k = 4 + m
  const fittedN = n - m

  let best = null
  for (const seasonalType of values.some((v) => v <= 0)
    ? ['additive']
    : ['additive', 'multiplicative']) {
    for (const alpha of grid.alpha) {
      for (const beta of grid.beta) {
        for (const gamma of grid.gamma) {
          for (const phi of grid.phi) {
            const r = fitWithParams(values, m, { alpha, beta, gamma, phi }, seasonalType)
            if (!r) continue
            const score = aicc(r.sse, fittedN, k)
            if (Number.isFinite(score) && (best === null || score < best.aicc)) {
              best = { ...r, aicc: score, m }
            }
          }
        }
      }
    }
  }
  return best
}

/**
 * 从拟合状态向前预测 h 步（h ≥ 1）。
 * @returns {number[]} 长度 h 的预测值数组（第 i 项 = 第 i 步）
 */
function forecastFromFit(fit, h) {
  const { states, params, m } = fit
  const { l, b, s } = states
  const phi = params.phi
  const out = []
  let phiCum = 0
  let phiPow = 1
  for (let i = 1; i <= h; i++) {
    phiPow *= phi
    phiCum += phiPow
    const sIdx = (m + i - 1) % m
    const trend = l + phiCum * b
    const value = fit.seasonalType === 'multiplicative' ? trend * s[sIdx] : trend + s[sIdx]
    out.push(value)
  }
  return out
}

module.exports = { DEFAULT_GRID, fitWithParams, fitHoltWinters, forecastFromFit, aicc }

// 情景系数边界：非有限/≤0 回退 FALLBACK_CONFIDENCE（=1.0），上限 2——
// 避免异常值经 Math.pow 产出 Infinity/NaN。
// 前端 UI 滑块限 0.8-1.2（设计语义），API 手工传 >1.2 属「有界放大」测试通道。
//
// 🔴 为什么叫 FALLBACK_ 而不是 DEFAULT_（2026-09-23 消歧）：这里说的"默认"是**入参非法时的
// 兜底值**，与前端 `frontend/src/shared/constants/forecast.ts` 的 DEFAULT_CONFIDENCE=0.8
//（UI 滑块默认阈值，即"用户没调过时用哪个阈值"）不是同一个概念，但两者曾同名同写一份，
// 改任一侧都没有守卫报差异、读代码的人也误以为同源（审查 923 记为「同名异值」）。
// 两侧各自的名字与值由 tools/v3-guard/forecast-confidence.mjs 钉住。
export const FALLBACK_CONFIDENCE = 1.0
export const MAX_CONFIDENCE = 2

/**
 * 置信度入参的**唯一**解析口（F3，2026-10-05）：
 * 非有限/≤0 ⇒ FALLBACK_CONFIDENCE；超过 MAX_CONFIDENCE ⇒ 钳到上限。
 * 原实现有两份（controller 局部 parseConfidence 有上限；task-handlers 两处手写
 * `Number.isFinite && >0` 无上限）⇒ 同参数 1e9 在同步/异步两路径不等价（异步侧结果可含
 * Infinity/NaN）。controller / task-handlers / forecast-engine 三处一律走本函数。
 */
export function parseConfidence(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return FALLBACK_CONFIDENCE
  return Math.min(n, MAX_CONFIDENCE)
}

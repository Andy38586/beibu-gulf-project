// 单位区间入参校验（2026-10-17 收口）：`parseResolution` / `parseMinLandFrac`（dto）与
// `parseWeights`（services/scoring.ts）三处各手抄同一条判据
// `!Number.isFinite(v) || v < 0 || v > 1`（dup 18×3）。同一事实三份 ⇒ 改一处必漏两处，
// 漏改的表现是静默放行非法入参（超范围分辨率、越界权重）。权威源在此，三处一律调用本函数。
export function isUnitInterval(v: number): boolean {
  return Number.isFinite(v) && v >= 0 && v <= 1
}

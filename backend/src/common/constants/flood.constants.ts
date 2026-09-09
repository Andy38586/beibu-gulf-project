// 水位上限（米）：与 FastAPI 参数约束（le=25）及滑块范围一致
// flood 模块入参与档位选取共用此界
export const MAX_WATER_LEVEL = 25

// 风险等级分段（六档语义：0 无 / 2 低 / 5 中 / 8 高 / 10 极高 / 15+ 灾难级）。
// 预计算档位表无 riskLevel 字段，由水位分段派生；阈值集中此处，
// 与 Express floodAnalysisController.js 及前端风险色档位同口径
export const RISK_LEVEL_BANDS = [
  { maxLevel: 0, label: '无风险' },
  { maxLevel: 2, label: '低风险' },
  { maxLevel: 5, label: '中风险' },
  { maxLevel: 8, label: '高风险' },
  { maxLevel: 10, label: '极高风险' },
  { maxLevel: Number.POSITIVE_INFINITY, label: '灾难级' },
] as const

/**
 * 按水位派生风险等级：预计算档位表无 riskLevel 字段，由水位分段向上命中首档。
 */
export function deriveRiskLevel(level: number): string {
  const band = RISK_LEVEL_BANDS.find((b) => level <= b.maxLevel)
  return (band ?? RISK_LEVEL_BANDS[RISK_LEVEL_BANDS.length - 1]).label
}

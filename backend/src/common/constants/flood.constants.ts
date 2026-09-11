// 水位上限（米）：251 档（0.1m 步进 0-25m）的数据档位上限。
// 前端同源值见 frontend/src/shared/constants/flood.ts（此前前端滑块写死 15，
// 后端注释谎称"与滑块一致"——双侧一致性现由 tools/v3-guard/constants-audit.mjs 断言）
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

/**
 * 按水位派生风险等级编码（0 无 / 1 低 / 2 中 / 3 高 / 4 极高 / 5 灾难），与
 * RISK_LEVEL_BANDS 下标同源（沿用原 floodStatistics.json 的 riskLevelCode 口径），
 * 使统计接口与档位接口共用同一张分段表。
 */
export function deriveRiskLevelCode(level: number): number {
  const index = RISK_LEVEL_BANDS.findIndex((b) => level <= b.maxLevel)
  return index === -1 ? RISK_LEVEL_BANDS.length - 1 : index
}

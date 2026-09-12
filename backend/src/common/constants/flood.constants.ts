// 水位上限（米）：251 档（0.1m 步进 0-25m）的数据档位上限。
// 前端同源值见 frontend/src/shared/constants/flood.ts（此前前端滑块写死 15，
// 后端注释谎称"与滑块一致"——双侧一致性现由 tools/v3-guard/constants-audit.mjs 断言）
// flood 模块入参与档位选取共用此界
export const MAX_WATER_LEVEL = 25

// 风险等级分段（六档，海平面/EGM96 基准；浸没基准重派生 2026-09-12 重划）。
// 阈值锚点（前四档水文硬锚点，后两档工程判断锚点——常量可调，调整须同步前端镜像
// frontend/src/shared/constants/flood.ts 的 RISK_LEVEL_THRESHOLDS）：
//   无风险 ≤0      平均海平面及以下（水位 ≤ MSL 时陆域无淹没——地形最低 0m）
//   低风险 ≤+2.0   平均海平面 → 设计高潮位（waterLevel.json mhhw=4.5 深度基准 − msl 2.5，50 年一遇）
//   中风险 ≤+4.3   设计高潮位 → 极端最高（extreme=6.8 深度基准 − 2.5，100 年一遇）
//   高风险 ≤+6.0   超出百年一遇 ~1.4 倍（工程判断锚点）
//   极高风险 ≤+8.0 主要港口设施高程下缘带（设施高程 0-27m，主体 5-12m；工程判断锚点）
//   灾难级 >+8.0   多数码头设施淹没
// 旧口径（0/2/5/8/10/15）为理论深度基准时代遗留，未随基准统一换算，已废弃；
// 预计算档位表无 riskLevel 字段，由水位分段派生；阈值集中此处。
export const RISK_LEVEL_BANDS = [
  { maxLevel: 0, label: '无风险' },
  { maxLevel: 2, label: '低风险' },
  { maxLevel: 4.3, label: '中风险' },
  { maxLevel: 6, label: '高风险' },
  { maxLevel: 8, label: '极高风险' },
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

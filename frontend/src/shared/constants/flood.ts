/**
 * 洪涝域跨层共享常量（前后端权威值互指，勿单侧修改）。
 * services 层禁止 import business（分层契约），故 floods 侧共享常量落 shared。
 */

// 水位上限（米）：与 backend/src/common/constants/flood.constants.ts 的 MAX_WATER_LEVEL
// 同源（251 档 0.1m 步进 0-25m，海平面/EGM96 口径），双侧一致性由 tools/v3-guard/constants-audit.mjs 断言。
// 口径分层（浸没基准重派生，2026-09-12）：本值是后端数据全域上限；前端展示域见
// FLOOD_DISPLAY_MAX_WATER_LEVEL —— 后端算全域，前端只暴露物理子集（用户口径）
export const MAX_WATER_LEVEL = 25

// 前端展示域水位上限（米，海平面基准）：0 = 平均海平面（waterLevel.json baseLevels.msl=2.5
// 深度基准换算后的统一口径）。上限 10 覆盖百年一遇极端最高 +4.3 并留余量；负水位（低潮态）
// 对浸没分析零信息（地形最低 0m，≤0 无淹没），不暴露。权威刻度三档见 WaterLevelProfilePanel
export const FLOOD_DISPLAY_MAX_WATER_LEVEL = 10

// 展示域风险分级阈值（米，海平面基准）：与 backend/src/common/constants/flood.constants.ts
// 的 RISK_LEVEL_BANDS 阈值同源（0 无 / 2 低 / 4.3 中 / 6 高 / 8 极高——水文锚定重划版
// 详见后端注释），单侧改动必须同步。
// 用途：剖面面板"当前风险"动态徽章（滑块 0.1m 步进下的实时分级，勿用作静态刻度标签——
// 刻度等距 0/2.5/5/7.5/10 与阈值不等距，硬贴档名会错档）
export const RISK_LEVEL_THRESHOLDS = [
  { maxLevel: 0, label: '无风险' },
  { maxLevel: 2, label: '低风险' },
  { maxLevel: 4.3, label: '中风险' },
  { maxLevel: 6, label: '高风险' },
  { maxLevel: 8, label: '极高风险' },
] as const

/** 按展示域水位派生风险等级文案（向上命中首档，口径与后端 deriveRiskLevel 一致） */
export function deriveRiskLevelDisplay(level: number): string {
  const band = RISK_LEVEL_THRESHOLDS.find((b) => level <= b.maxLevel)
  return (band ?? RISK_LEVEL_THRESHOLDS[RISK_LEVEL_THRESHOLDS.length - 1]).label
}

// 风险等级缺省标签：与 backend/src/common/constants/flood.constants.ts 的
// RISK_LEVEL_BANDS[0].label（'无风险'）同源，改任一侧必须同步。
// 前端配色键（business/flood-analysis/constants/colors.ts）以中文标签为键，
// riskLevelCode 作为唯一 join 键的完整迁移见台账（架构 P1-3）
export const DEFAULT_RISK_LEVEL = '无风险'

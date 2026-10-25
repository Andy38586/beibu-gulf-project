/**
 * 洪涝风险等级配色（仅洪水业务使用，从 shared 下沉到业务层）。
 * stroke: 边界线色；fill: 填充色（由 stroke 按档位 alpha 派生，不再手抄第二份 rgba）
 *
 * 色值不在本文件出现：stroke 取 `shared/constants/colors.ts` 语义色表的 **map 变体**
 * （地图通道；按水面背景 ≥3:1），fill 由同一 stroke 经 `withAlpha` 派生。
 * 「无风险」不是语义状态色（UI 侧无对应 CSS token），取共享的中性灰常量。
 * 这样改语义色只需改单源表一处，本文件不会再有第二份字面量可漂移。
 */
import { FLOOD_RISK_NEUTRAL_COLOR, SEMANTIC_COLORS, withAlpha } from '@/shared'

/** 一档风险色：stroke + 同色同 alpha 的 fill（alpha 按档位递进） */
const riskTier = (stroke: string, alpha: number) => ({
  stroke,
  fill: withAlpha(stroke, alpha),
})

export const FLOOD_RISK_COLORS: Record<string, { stroke: string; fill: string }> = {
  无风险: riskTier(FLOOD_RISK_NEUTRAL_COLOR, 0.3),
  低风险: riskTier(SEMANTIC_COLORS.success.map, 0.3),
  中风险: riskTier(SEMANTIC_COLORS.warning.map, 0.3),
  高风险: riskTier(SEMANTIC_COLORS.danger.map, 0.3),
  极高风险: riskTier(SEMANTIC_COLORS.danger.map, 0.4),
  灾难级: riskTier(SEMANTIC_COLORS.danger.map, 0.5),
}

export const FLOOD_RISK_DEFAULT = FLOOD_RISK_COLORS['无风险']

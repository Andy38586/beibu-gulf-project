/**
 * 设施中文标签映射
 * 为什么在 shared（c024 确认保留）：
 * - visualization 层（useRadarChart / RadarScoreTooltip）需要标签渲染雷达图
 * - business 层（facilityConfig）也需要标签配置
 * - 将标签集中在 shared，两层都从此取，避免 visualization → business 跨层依赖
 * （dependency-cruiser 规则 visualization-should-not-import-business 为 error 级）
 * 业务逻辑（半径、权重等）仍保留在
 * business/site-selection/composables/facilityConfig.ts
 */
export const FACILITY_LABELS: Record<string, string> = {
  hospital: '医院',
  primary_school: '小学',
  middle_school: '中学',
  park: '公园',
  bus_station: '公交站',
  mall: '商场',
}

/**
 * 经济损失格式化（2026-08-09 P1-6：原洪涝两面板各定义一份 → 收拢 shared）
 * - 非法输入防御：非有限/undefined → '—'
 * - 基础单位万元；≥ 10000 万（1 亿）换算为亿
 */
export function formatLoss(loss: number | undefined): string {
  const v = Number(loss)
  if (!isFinite(v)) return '—'
  if (v >= 10000) {
    return (v / 10000).toFixed(1) + '亿'
  }
  return v.toFixed(0) + '万'
}


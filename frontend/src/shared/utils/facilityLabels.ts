/**
 * 设施中文标签映射
 *
 * 为什么在 shared（c024 确认保留）：
 * - visualization 层（useRadarChart / RadarScoreTooltip）需要标签渲染雷达图
 * - business 层（facilityConfig）也需要标签配置
 * - 将标签集中在 shared，两层都从此取，避免 visualization → business 跨层依赖
 *   （dependency-cruiser 规则 visualization-should-not-import-business 为 error 级）
 *
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

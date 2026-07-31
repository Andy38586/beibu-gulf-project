/**
 * 渲染层集中色（单一事实源）
 *
 * 为什么存在这个文件：
 * OL / Cesium 渲染到 canvas / WebGL，ECharts 渲染到 canvas / SVG，
 * 这些渲染目标无法解析 CSS 变量（var(--GCS-*)），必须用具体色值。
 * 因此「渲染层颜色」集中在这里，而「DOM/CSS 层颜色」集中在 style.css 的 CSS Token。
 *
 * 约定（见 docs/工程规范与性能参考.md）：
 * - 业务 / 渲染 / 图层代码禁止散落 #hex，一律从这里取。
 * - 仅 style.css（token 定义）与 colors.ts（集中常量）保留 hex。
 */

// 设施 / 要素配色（港口、覆盖、匹配、边界等）
// 索引约定：0=port 1=safe 2=danger 3=boundary
export const FACILITY_COLORS = ['#409eff', '#67C23A', '#e74c3c', '#4dabf7'] as const

/**
 * 设施配色映射（从 business 层提升到 shared）
 *
 * 为什么在 shared/constants：
 * - visualization 层（useRadarChart / RadarScoreTooltip）需要设施色值渲染雷达图
 * - business 层（facilityConfig）也需要色值配置
 * - 将色值集中在 shared，两层都从此取，避免 visualization → business 跨层依赖
 *   （dependency-cruiser 规则 visualization-should-not-import-business 为 warn 级）
 *
 * 业务逻辑（半径、权重等）仍保留在
 * business/site-selection/composables/facilityConfig.js
 */
export const FACILITY_COLORS_MAP: Record<string, string> = {
  hospital: '#e74c3c',
  primary_school: '#3498db',
  middle_school: '#9b59b6',
  park: '#2ecc71',
  bus_station: '#f39c12',
  mall: '#1abc9c',
}

// 图层默认回退色（renderer 在无 options 覆盖时使用）
export const LAYER_DEFAULTS = {
  color: '#409eff', // 默认点 / 要素色
  stroke: '#4dabf7', // 默认描边（边界 / 多边形）
  marker: '#409eff', // 默认标记色
  fillColor: '#4dabf7', // 默认填充色（polygon / geojson）
  fill: 'rgba(77, 171, 247, 0.2)',
  outline: '#ffffff', // 描边 / 外框白
  text: '#000000', // 标注文字黑
  heatmapGradient: ['#00f', '#0ff', '#0f0', '#ff0', '#f00'],
} as const

// 水位剖面图系列色
export const PROFILE_COLORS = {
  water: '#409EFF',
  safe: '#67C23A',
} as const

// 开发验收用的 QA 覆盖层调试色（GCSInspectionOverlay）
export const INSPECTION_COLORS = {
  primary: '#ff6b6b',
  warn: '#ffa502',
  danger: '#ff3838',
  highlight: '#ffd93d',
  muted: '#95a5a6',
  ok: '#2ecc71',
} as const

/**
 * 洪涝风险等级配色（c015：从 FloodAnalysisPage 抽取）
 * stroke: 边界线色；fill: 填充色（带透明度）
 */
export const FLOOD_RISK_COLORS: Record<string, { stroke: string; fill: string }> = {
  无风险: { stroke: '#909399', fill: 'rgba(144, 147, 153, 0.3)' },
  低风险: { stroke: '#67C23A', fill: 'rgba(103, 194, 58, 0.3)' },
  中风险: { stroke: '#E6A23C', fill: 'rgba(230, 162, 60, 0.3)' },
  高风险: { stroke: '#F56C6C', fill: 'rgba(245, 108, 108, 0.3)' },
  极高风险: { stroke: '#F56C6C', fill: 'rgba(245, 108, 108, 0.4)' },
  灾难级: { stroke: '#F56C6C', fill: 'rgba(245, 108, 108, 0.5)' },
}

export const FLOOD_RISK_DEFAULT = FLOOD_RISK_COLORS['无风险']

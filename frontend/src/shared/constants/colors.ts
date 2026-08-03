/**
 * 渲染层集中色（单一事实源）
 * 为什么存在这个文件：
 * OL / Cesium 渲染到 canvas / WebGL，ECharts 渲染到 canvas / SVG，
 * 这些渲染目标无法解析 CSS 变量（var(--GCS-*)），必须用具体色值。
 * 因此「渲染层颜色」集中在这里，而「DOM/CSS 层颜色」集中在 style.css 的 CSS Token。
 * 约定（见 docs/工程规范与性能参考.md）：
 * - 业务 / 渲染 / 图层代码禁止散落 #hex，一律从这里取。
 * - 仅 style.css（token 定义）与 colors.ts（集中常量）保留 hex。
 */

// 设施 / 要素配色（港口、覆盖、匹配、边界等）
// 索引约定：0=port 1=safe 2=danger 3=boundary
export const FACILITY_COLORS = ['#409eff', '#67C23A', '#e74c3c', '#4dabf7'] as const

/**
 * 设施配色映射（从 business 层提升到 shared）
 * 为什么在 shared/constants：
 * - visualization 层（useRadarChart / RadarScoreTooltip）需要设施色值渲染雷达图
 * - business 层（facilityConfig）也需要色值配置
 * - 将色值集中在 shared，两层都从此取，避免 visualization → business 跨层依赖
 * （dependency-cruiser 规则 visualization-should-not-import-business 为 warn 级）
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
  boundaryFill: 'rgba(77,171,247,0.15)', // 边界图层填充（从 useBoundaryLayer 提取的硬编码字面量）
  fill: 'rgba(77, 171, 247, 0.2)',
  outline: '#ffffff', // 描边 / 外框白
  text: '#000000', // 标注文字黑
  heatmapGradient: ['#00f', '#0ff', '#0f0', '#ff0', '#f00'],
  // 图层叠放层级（OL setZIndex 默认值，消除对 addLayer 调用顺序的依赖）
  zIndex: 10, // 业务图层默认层级
  zIndexBase: 0, // 底图
  zIndexOverlay: 100, // 覆盖层（水面 / 呼吸动画 / 淹没）
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

// FLOOD_RISK_COLORS / FLOOD_RISK_DEFAULT 已下沉至
// business/flood-analysis/constants/colors.ts（仅洪水业务使用）

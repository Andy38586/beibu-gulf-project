/**
 * 渲染层集中色（单一事实源）：canvas/WebGL/SVG 渲染无法解析 CSS 变量（var(--GCS-*)），必须用具体色值，
 * 故渲染色集中于此，DOM/CSS 层颜色走 style.css 的 Token；业务/渲染/图层代码禁止散落 #hex，一律从此取。
 */

// 设施/要素配色（港口、覆盖、匹配、边界等）；索引：0=港口 1=安全 2=危险 3=边界
export const FACILITY_COLORS = ['#409eff', '#67C23A', '#e74c3c', '#4dabf7'] as const

/**
 * 设施配色映射：visualization 与 business 两层都需要，集中 shared 避免跨层依赖
 * （dependency-cruiser 规则 visualization-should-not-import-business 为 warn 级）。
 * 业务逻辑（半径、权重等）仍在 business/site-selection/composables/facilityConfig.ts。
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

// ECharts 图表主题色（canvas 渲染无法解析 CSS 变量，亮/暗双主题；收口图表硬编码色）
export const CHART_COLORS = {
  textPrimary: { light: '#303133', dark: '#e8edf4' },
  textSecondary: { light: '#666666', dark: '#a8b2bd' },
  textMuted: { light: '#999999', dark: '#7a8694' },
  axisLine: { light: '#dddddd', dark: '#2c4a70' },
  splitLine: { light: '#eeeeee', dark: '#1f3450' },
  accent: { light: '#409eff', dark: '#ff7a1a' },
} as const

// 开发验收用的 QA 覆盖层调试色（GCSDebugOverlay）
export const INSPECTION_COLORS = {
  primary: '#ff6b6b',
  warn: '#ffa502',
  danger: '#ff3838',
  highlight: '#ffd93d',
  muted: '#95a5a6',
  ok: '#2ecc71',
} as const

// FLOOD_RISK_* 配色已下沉至 business/flood-analysis/constants/colors.ts（仅洪涝业务使用）

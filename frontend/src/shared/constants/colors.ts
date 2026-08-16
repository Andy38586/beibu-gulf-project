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

/** 设施未知 key 兜底色（S7-31：原两处散落 '#666' 收口；仅图表 fallback 用，未知设施类型按中性灰显示） */
export const FACILITY_FALLBACK_COLOR = '#666666'

// 水面/覆盖层填充色（primary #409eff 的透明度派生，S7-03：收口两处散落 rgba 硬编码）
/** 水面填充（FloodAnalysisPage 水面图层） */
export const LAYER_FILL_WATER = 'rgba(64, 158, 255, 0.5)'
/** 覆盖层填充（useAnalysisLayer COVERAGE_STYLE） */
export const LAYER_FILL_COVERAGE = 'rgba(64, 158, 255, 0.15)'

// S7-12：剖面面积渐变 stops（success 绿 #67C23A 派生，WaterLevelProfilePanel 面积图）
/** 剖面面积渐变-强端（近水面） */
export const PROFILE_AREA_STOP_STRONG = 'rgba(103, 194, 58, 0.3)'
/** 剖面面积渐变-弱端（远离水面） */
export const PROFILE_AREA_STOP_WEAK = 'rgba(103, 194, 58, 0.05)'

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
  labelBackground: 'rgba(255, 255, 255, 0.8)', // 点标注白底（816-专项4 6.3：Cesium label 收口）
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
  // 816-S7-34：多分类系列色板（03 §三.2「chart：c1-c6」规格落地；暗色提亮一档保对比度），
  // useChartBase 顶层注入 color，替代 ECharts 默认 #5470c6 系列
  seriesPalette: {
    light: ['#409eff', '#67c23a', '#e6a23c', '#f56c6c', '#9b59b6', '#1abc9c'],
    dark: ['#66b1ff', '#57d97c', '#f0b35a', '#ff7a7d', '#b98ae0', '#3ed0b0'],
  },
  // 816-S7-49：雷达图 splitArea 叠层（原 useRadarChart 内 rgba 硬编码收敛）
  radarSplitArea: {
    light: ['rgba(255,255,255,0.1)', 'rgba(255,255,255,0.3)'],
    dark: ['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.12)'],
  },
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

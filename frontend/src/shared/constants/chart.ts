/**
 * 图表统一布局 Token（可视化看板外边距的单一事实源）：
 * LineChart / BarChart 的 grid 共用此值（标题/坐标轴均在 canvas 内，需 40px 上边距）。
 * RadarChart 不在此列：其标题与综合评分是面板内 HTML 元素，canvas 内只做居中最大化。
 * 单位 px；数值与 GCS cell（80px）对齐：top/bottom/left = 0.5 cell，right = 0.2 cell。
 */
export const CHART_GRID = { top: 40, right: 16, bottom: 40, left: 40 } as const

/**
 * 雷达图轴名避让量与间距：
 * - RADAR_AXIS_NAME_GAP：轴名文字到多边形顶点的间距（ECharts radar.axisName.gap）——越小字越贴雷达。
 * - RADAR_AXIS_NAME_ALLOWANCE：轴名文字在顶点外伸出的总量（gap + 字号），
 *   radar radius = min(宽,高)/2 - 该值，保证上下轴名文字都留在容器（标题区下沿 ~ 容器底）内。
 */
export const RADAR_AXIS_NAME_GAP = 15
export const RADAR_AXIS_NAME_FONT_SIZE = 15
export const RADAR_AXIS_NAME_ALLOWANCE = RADAR_AXIS_NAME_GAP + RADAR_AXIS_NAME_FONT_SIZE

/**
 * 雷达图得分详情面板（RadarScoreTooltip）尺寸（单位：GCS cell 数）：
 * useRadarChart 定位公式与 RadarScoreTooltip 自身宽高必须共用此单一来源，
 * 否则定位（left/top）与渲染（width/height）会因两份魔法数漂移而错位。
 */
export const RADAR_TOOLTIP_WIDTH_CELL = 2
export const RADAR_TOOLTIP_HEIGHT_CELL = 3

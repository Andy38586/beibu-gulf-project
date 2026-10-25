/**
 * 渲染层集中色（单一事实源）：canvas/WebGL/SVG 渲染无法解析 CSS 变量（var(--GCS-*)），必须用具体色值，
 * 故渲染色集中于此，DOM/CSS 层颜色走 style.css 的 Token；业务/渲染/图层代码禁止散落 #hex，一律从此取。
 */

/**
 * 品牌主色（品牌蓝）。本文件是渲染色值的单一事实源，而**品牌蓝本身**此前在文件内又手抄了
 * 六处（含一处大小写不同的 `#409EFF`）——单一事实源内部再分叉，改主色必漏。此常量是它的唯一字面量。
 */
const COLOR_PRIMARY = '#409eff'

/**
 * 港口要素渲染色（原 `FACILITY_COLORS[0]` 具名化，2026-10-13 收口 A2）。
 * 原为 4 元色板 `['#409eff','#67C23A','#e74c3c','#4dabf7']`，实测**只有 [0] 被消费**（usePortLayer）；
 * [1..3] 零消费，且这三个色在本文件他处各有具名来源（success 绿 → PROFILE_AREA_STOP_* 的 rgba 派生、
 * 危险红 → FACILITY_COLORS_MAP.hospital、边界蓝 → LAYER_DEFAULTS.stroke）⇒ 色板拆掉。
 */
export const PORT_FEATURE_COLOR = COLOR_PRIMARY

/**
 * 语义色单一源（2026-10-25 用户裁决 C）：同一语义在两条渲染通道各需一份表示，
 * 允许值不同，但必须同源于此表，不得各写一份副本。
 *
 * · `ui`  —— DOM/CSS 通道。**逐值等于** `style.css` 亮色主题的 `--GCS-color-*`
 *   （success rgb(24 122 48) / warning rgb(163 99 0) / danger rgb(204 58 77)，
 *   白底对比度 5.43 / 4.84 / 4.91，均为 WCAG AA）。
 *   改这里等于改 CSS：`tools/v3-guard/color-channel-parity.mjs` 判严格相等，任一侧单改即红。
 * · `map` —— canvas/Cesium 通道。风险面/线叠在底图与海面上，背景不是面板白
 *   （`--GCS-bg-*` 不适用），故按 `SEMANTIC_MAP_BACKGROUND` 取 ≥3:1；为达标允许比 ui 更深。
 *
 * 为什么不是两套独立副本：两套副本会各自演化——W67 实测的 2.24 / 2.19 / 2.90 就是
 * canvas 侧没跟上 CSS 提深留下的。这里只有一个表、两个变体，消费侧按所在通道取值。
 *
 * ⚠️ 机器可读契约：`tools/v3-guard/color-channel-parity.mjs` 按
 * `key: { ui: '#rrggbb', map: '#rrggbb' }` 的单行形态解析本表。格式化可以（多空格/换行），
 * 但键名、字段名与引号形态不要改；改了不起作用会红，不会静默放过。
 */
export const SEMANTIC_COLORS = {
  // 白底 5.43；地图背景 #409eff 上 3.35
  success: { ui: '#187a30', map: '#125223' },
  // 白底 4.84；地图背景 #409eff 上 3.17
  warning: { ui: '#a36300', map: '#6b4100' },
  // 白底 4.91；地图背景 #409eff 上 3.21
  danger: { ui: '#cc3a4d', map: '#8a2230' },
} as const

/**
 * 地图侧对比度的代表背景（可逐值复核的常量，不是从截图取样）。
 *
 * 取色依据：洪涝风险面/线叠加在 3D 水面与海面上，而 `LAYER_FILL_WATER`
 * （本文件下方 `rgba(64, 158, 255, 0.5)`）是仓库内**唯一具名的水面色**。这里取它的
 * RGB 分量（alpha 合成前的图层本色）作为代表背景：
 *   · 不依赖天地图影像像素 —— 截图不可复现，无法作为门禁输入；
 *   · 比 50% 叠在浅色海面影像上的合成结果更深 —— 对深色 stroke 更不利，取判据偏保守。
 * 不用 `--GCS-bg`（面板白）当背景：地图画布不是面板，白底会把可读性算高。
 *
 * 守卫会核对本常量与 `LAYER_FILL_WATER` 的 RGB 相等；水面层换色时二者必须同步。
 */
export const SEMANTIC_MAP_BACKGROUND = '#409eff'

/**
 * 洪涝「无风险」档中性灰（地图变体）。
 *
 * 它不是语义状态色：UI 侧没有 `--GCS-color-neutral`，故不进 `SEMANTIC_COLORS`
 * （那张表的每个 `ui` 都必须能在 style.css 找到对应 token，否则对账失去对象）。
 * 原 `#909399` 在 `#409eff` 水面上只有 1.11:1，按地图侧 ≥3:1 提到 `#44474c`（3.35:1）。
 */
export const FLOOD_RISK_NEUTRAL_COLOR = '#44474c'

/**
 * 给 `#rrggbb` 加透明度，产出 `rgba(r, g, b, a)`。
 * 用途：风险档位的 fill 从同一 stroke 派生（stroke 改了 fill 自动跟，不再手抄两份 rgba）。
 */
export function withAlpha(hex: string, alpha: number): string {
  const s = hex.replace('#', '')
  const full = s.length === 3 ? [...s].map((c) => c + c).join('') : s
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * 设施配色映射：visualization 与 business 两层都需要，集中 shared 避免跨层依赖
 * （dependency-cruiser 规则 visualization-should-not-import-business 为 warn 级）。
 * 业务逻辑（半径、权重等）随旧版选址域一并移除（2026-10-02）。
 */
export const FACILITY_COLORS_MAP: Record<string, string> = {
  hospital: '#e74c3c',
  // 原 #3498db 蓝色与匹配小区/港口蓝无法区分——品红为现有色相环唯一大空档（320°）
  primary_school: '#eb2f96',
  middle_school: '#9b59b6',
  park: '#2ecc71',
  bus_station: '#f39c12',
  mall: '#1abc9c',
}

/** 设施未知 key 兜底色（原两处散落 '#666' 收口；仅图表 fallback 用，未知设施类型按中性灰显示） */
export const FACILITY_FALLBACK_COLOR = '#666666'

/**
 * 取设施渲染色：唯一入口，避免图表侧手抄 `FACILITY_COLORS_MAP[key] || FACILITY_FALLBACK_COLOR`
 * （2026-10-18 收口 RadarScoreTooltip 与 useRadarChart 两处同构实现）。
 */
export function facilityColor(key: string): string {
  return FACILITY_COLORS_MAP[key] || FACILITY_FALLBACK_COLOR
}

// 水面/覆盖层填充色（COLOR_PRIMARY 的透明度派生，收口两处散落 rgba 硬编码）
/** 水面填充（FloodAnalysisPage 水面图层） */
export const LAYER_FILL_WATER = 'rgba(64, 158, 255, 0.5)'

// 剖面面积渐变 stops（success 绿 #67C23A 派生，WaterLevelProfilePanel 面积图）
/** 剖面面积渐变-强端（近水面） */
export const PROFILE_AREA_STOP_STRONG = 'rgba(103, 194, 58, 0.3)'
/** 剖面面积渐变-弱端（远离水面） */
export const PROFILE_AREA_STOP_WEAK = 'rgba(103, 194, 58, 0.05)'

// 图层默认回退色（renderer 在无 options 覆盖时使用）
export const LAYER_DEFAULTS = {
  color: COLOR_PRIMARY, // 默认点 / 要素色
  stroke: '#4dabf7', // 默认描边（边界 / 多边形）
  marker: COLOR_PRIMARY, // 默认标记色
  boundaryFill: 'rgba(77,171,247,0.15)', // 边界图层填充（从 useBoundaryLayer 提取的硬编码字面量）
  fill: 'rgba(77, 171, 247, 0.2)',
  outline: '#ffffff', // 描边 / 外框白
  text: '#000000', // 标注文字黑
  labelBackground: 'rgba(255, 255, 255, 0.8)', // 点标注白底（Cesium label 收口）
  heatmapGradient: ['#00f', '#0ff', '#0f0', '#ff0', '#f00'],
  // 图层叠放层级（OL setZIndex 默认值，消除对 addLayer 调用顺序的依赖）
  zIndex: 10, // 业务图层默认层级
  zIndexBase: 0, // 底图
  zIndexCover: 15, // 覆盖类业务层（淹没范围 / 受影响设施 / 预测图层）：叠在普通业务层之上
  zIndexOverlay: 100, // 覆盖层（水面 / 呼吸动画 / 淹没）
} as const

// ===== 拖出图层（LayerIR）与任务结果芯片 =====
/**
 * 品牌蓝渲染色（单一来源）：route-analysis 路径线 与 LayerIR flood-areas 域色同值，
 * 两处都从此取——改一处即两处同变（G3 收口：原两处手抄同值）。
 */
export const RENDER_BLUE = '#3b82f6'
/** 橙色渲染色（单一来源）：LayerIR route-path 域色。 */
const RENDER_ORANGE = '#f59e0b'
/** LayerIR 域色表（LayerIR.ts 消费）：域语义标签仍在 LayerIR，颜色只在这里。 */
export const LAYER_IR_DOMAIN_COLORS = {
  'flood-areas': RENDER_BLUE,
  'route-path': RENDER_ORANGE,
} as const
/**
 * 任务结果芯片 / 堆叠卡渲染色兜底（单一来源）：App.vue、TaskResultChip、StackSlot
 * 三处同值（G3 收口：原三副本零断言）。
 */
export const IR_FALLBACK_COLOR = '#8a93a6'

// 水位剖面图系列色
export const PROFILE_COLORS = {
  water: COLOR_PRIMARY, // 2026-10-13 收口：原为不同大小写的 '#409EFF'
  safe: '#67C23A',
} as const

// ECharts 图表主题色（canvas 渲染无法解析 CSS 变量，亮/暗双主题；收口图表硬编码色）
export const CHART_COLORS = {
  textPrimary: { light: '#303133', dark: '#e8edf4' },
  textSecondary: { light: '#666666', dark: '#a8b2bd' },
  textMuted: { light: '#999999', dark: '#7a8694' },
  axisLine: { light: '#dddddd', dark: '#2c4a70' },
  splitLine: { light: '#eeeeee', dark: '#1f3450' },
  accent: { light: COLOR_PRIMARY, dark: '#ff7a1a' },
  // 多分类系列色板，
  // useChartBase 顶层注入 color，替代 ECharts 默认 #5470c6 系列
  seriesPalette: {
    light: [COLOR_PRIMARY, '#67c23a', '#e6a23c', '#f56c6c', '#9b59b6', '#1abc9c'],
    dark: ['#66b1ff', '#57d97c', '#f0b35a', '#ff7a7d', '#b98ae0', '#3ed0b0'],
  },
  // 雷达图 splitArea 叠层（原 useRadarChart 内 rgba 硬编码收敛）
  radarSplitArea: {
    light: ['rgba(255,255,255,0.1)', 'rgba(255,255,255,0.3)'],
    dark: ['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.12)'],
  },
} as const

/**
 * 取图表主题色：唯一入口，避免各图表 option 内手抄 `dark ? CHART_COLORS.x.dark : CHART_COLORS.x.light`。
 * 亮/暗取值仍以 CHART_COLORS 为权威源，此处只做「按当前主题二选一」；
 * 形参只收双主题标量键（seriesPalette / radarSplitArea 是数组，不走本入口）。
 */
export function chartColor(
  key: Exclude<keyof typeof CHART_COLORS, 'seriesPalette' | 'radarSplitArea'>,
  dark: boolean
): string {
  return CHART_COLORS[key][dark ? 'dark' : 'light']
}

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

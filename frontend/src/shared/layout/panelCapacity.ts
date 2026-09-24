// GCS 面板网格容量：由「面板高度 + 盒子模型比例」推导可完整呈现的条目数（c043）。
//
// 为什么要有这个函数：容量此前只活在注释里（`LayerControlPanel.vue` 写着"4×4 面板内
// 2列×4行共 8 按钮**正好填满**"），而目录条目是**运行期派生**的（航线页 14 项、
// 首屏 12 项）⇒ 多出的 6 个开关存在、却落在 `GCSPanel` 的 `overflow:hidden` 之外，
// 无断言、无收纳、无出口。任何"钉 8 / 钉 13 / 钉 14"的判据都会在下一次目录变化时失效，
// 故容量必须**按公式算**，并且"超出时有可达出口"要成为可断言的事实。
import { CELL_PIXEL } from './config'

/** 盒子模型比例（相对 1 cell）：面板内边距 0.1cell、按钮行高 0.8cell、行间距 0.2cell */
export const PANEL_PADDING_CELL = 0.1
export const ROW_HEIGHT_CELL = 0.8
export const ROW_GAP_CELL = 0.2
/** 三处控制面板统一 2 列（LayerControlPanel / SiteAnalysisControlPanel / ForecastControlPanel） */
export const PANEL_COLUMNS = 2

export interface PanelGridCapacityInput {
  /** 面板高度，单位 cell（GCSPanel 的 `h` 属性值） */
  heightCells: number
  /** 1 cell 的像素现值（`useGCS().cellPixel`；窄屏会缩小）；缺省取桌面基准 */
  cellPx?: number
  /** 列数，缺省 2 */
  columns?: number
}

/**
 * 面板网格在给定高度下能**完整呈现**（不被容器裁切）的条目数上界。
 *
 * 可放行数 = ⌊(可用高 + 行间距) / (行高 + 行间距)⌋，容量 = 行数 × 列数。
 * 比例全用 cell 表达 ⇒ 容量不随 cellPixel 漂移（实测 cell 70/80/90 下 h=4 均为 8）。
 *
 * @returns 容量上界（≥0）
 */
export function panelGridCapacity({
  heightCells,
  cellPx = CELL_PIXEL,
  columns = PANEL_COLUMNS,
}: PanelGridCapacityInput): number {
  const cell = cellPx > 0 ? cellPx : CELL_PIXEL
  const available = heightCells * cell - 2 * PANEL_PADDING_CELL * cell
  const rowH = ROW_HEIGHT_CELL * cell
  const gap = ROW_GAP_CELL * cell
  const rows = Math.floor((available + gap) / (rowH + gap))
  return Math.max(0, rows) * columns
}

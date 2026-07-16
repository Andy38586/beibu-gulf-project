/**
 * GCS（Grid Cell System）全局布局配置
 *
 * 本文件是统一尺寸来源，所有面板、Zone、按钮的尺寸都必须通过此配置计算，
 * 禁止在组件中硬编码 px 值。
 */

/** Cell 最小逻辑单位像素值。文档推荐默认值为 80，以兼顾 1920×1080 及以下视口 */
export const CELL_PIXEL = 80

/** Cell 内边距，Panel 距 Cell 边缘的距离 */
export const CELL_PADDING = 10

/** Panel 可见区域像素值 = Cell 尺寸减去两侧内边距 */
export const PANEL_PIXEL = CELL_PIXEL - CELL_PADDING * 2

/**
 * Panel 之间的间隙
 * 按项目约定：GAP = 2 * (CELL_PIXEL - PANEL_PIXEL) / 2 = CELL_PIXEL - PANEL_PIXEL = 20
 * 等价于两侧 CELL_PADDING 之和，确保 4×4 Cell 的 Zone 恰好容纳 4×4 Panel。
 */
export const GAP = CELL_PIXEL - PANEL_PIXEL

/** 桌面端默认 CELL_PIXEL */
export const CELL_PIXEL_DEFAULT = CELL_PIXEL

/** 响应式断点对应的 CELL_PIXEL 查表 */
export function getCellPixelByViewport(width) {
  if (width >= 1920) return 90
  if (width >= 1366) return 80
  if (width >= 1024) return 80
  if (width >= 768) return 70
  return 60
}

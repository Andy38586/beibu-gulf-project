/**
 * GCS V2 全局布局配置
 *
 * 本文件是统一尺寸来源，所有面板、按钮的尺寸都必须通过此配置计算，
 * 禁止在组件中硬编码 px 值。
 *
 * V2 变更说明：
 * - GAP 从 20 重新定义为 10（基础间距单位）
 * - 新增 PANEL_SPACING = 20（Panel 间距，取代 V1 的 GAP 职责）
 * - 新增 GRID_SIZE = 100（Grid 参考线参数，仅检查模式使用）
 */

/** Cell 最小逻辑单位像素值。文档推荐默认值为 80，以兼顾 1920×1080 及以下视口 */
export const CELL_PIXEL = 80

/**
 * GCS V2 基础间距单位
 * 是 PANEL_SPACING 和 CELL_PADDING 的派生源
 * V2 重新定义：从 20px 改为 10px
 */
export const GAP = 10

/**
 * Panel 内部 padding = 1 × GAP
 * Panel 内容区域与 Cell 边缘的距离
 */
export const CELL_PADDING = GAP // 10px

/**
 * Panel 之间的间距 = 2 × GAP
 * 替代 V1 的 GAP（20px），是 Panel 间距的真正来源
 */
export const PANEL_SPACING = GAP * 2 // 20px

/**
 * Panel 到 Canvas 边缘的距离 = PANEL_SPACING
 * 统一来源，禁止在组件中硬编码 20px
 */
export const SAFE_MARGIN = PANEL_SPACING // 20px

/**
 * Grid 参考线间距（仅检查模式使用）
 * Grid 是视觉参考线，不参与布局计算
 */
export const GRID_SIZE = 100

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

/**
 * 计算 w×h 个 Cell 占据的像素尺寸
 * @param {number} w - 横向 Cell 数
 * @param {number} h - 纵向 Cell 数
 * @returns {{ width: number, height: number }}
 */
export function cellSize(w, h) {
  return {
    width: w * CELL_PIXEL,
    height: h * CELL_PIXEL,
  }
}

/**
 * 计算 Panel 内部内容区域的像素尺寸
 * @param {number} w - 横向 Cell 数
 * @param {number} h - 纵向 Cell 数
 * @returns {{ width: number, height: number }}
 */
export function panelContentSize(w, h) {
  return {
    width: w * CELL_PIXEL - 2 * CELL_PADDING,
    height: h * CELL_PIXEL - 2 * CELL_PADDING,
  }
}

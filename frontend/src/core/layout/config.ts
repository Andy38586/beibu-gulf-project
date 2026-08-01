// GCS V2 全局布局配置，所有面板尺寸统一来源，禁止组件硬编码 px
export const CELL_PIXEL = 80

// GAP = 10 是 PANEL_SPACING 和 CELL_PADDING 的派生源（V2 从 20 改为 10）
export const GAP = 10
export const CELL_PADDING = GAP
export const PANEL_SPACING = GAP * 2
export const SAFE_MARGIN = PANEL_SPACING
export const GRID_SIZE = 100

export function getCellPixelByViewport(width: number): number {
  if (width >= 1920) return 90
  if (width >= 1366) return 80
  if (width >= 1024) return 80
  if (width >= 768) return 70
  return 60
}

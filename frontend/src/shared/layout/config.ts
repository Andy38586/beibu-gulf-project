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
  if (width >= 960) return 80
  // 最低档 70（用户决策 2026-08-09：不降到 60；<960 进入抽屉布局，cell 不再缩）
  return 70
}

// ===== 响应式布局档位（2026-08-09 用户决策） =====
// 一个 4-cell 面板宽 = 4 × 80 = 320px（桌面基准）
// 档位 1 桌面等比例：视口 ≥ 3 个面板宽（960px），cell 80（1920+ 为 90）
// 档位 2 抽屉模式：640px ≤ 视口 < 960px（2~3 个面板宽），cell 70，面板收进抽屉
// 档位 3 抽屉紧凑：视口 < 640px（<2 个面板宽），cell 70，底部 nav 需另行设计
export const LAYOUT_DESKTOP_MIN = 3 * 4 * 80 // 960
export const LAYOUT_DRAWER_MIN = 2 * 4 * 80 // 640

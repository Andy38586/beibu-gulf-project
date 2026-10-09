// GCS（网格化布局系统）全局布局配置：所有面板尺寸的统一来源，禁止组件硬编码 px
export const CELL_PIXEL = 80

// GAP 是 PANEL_SPACING 与 CELL_PADDING 的派生源
export const GAP = 10
export const CELL_PADDING = GAP
export const PANEL_SPACING = GAP * 2
export const SAFE_MARGIN = PANEL_SPACING
export const GRID_SIZE = 100

export function getCellPixelByViewport(width: number): number {
  if (width >= 1920) return 90
  if (width >= 960) return 80
  // 最低档 70：<960 进入抽屉布局后 cell 不再缩
  return 70
}

// ===== 响应式布局档位 =====
// 4-cell 面板宽 = 320px（桌面基准）
// 档位 1 桌面：≥960px（3 个面板宽），cell 80（1920+ 为 90）
// 档位 2 抽屉模式：640~959px，cell 70，面板收进侧滑抽屉
// 档位 3 紧凑：<640px，cell 70，底部 nav 另行设计
const LAYOUT_DESKTOP_MIN = 3 * 4 * 80 // 960
const LAYOUT_DRAWER_MIN = 2 * 4 * 80 // 640

export type LayoutTier = 'desktop' | 'drawer' | 'compact'

/**
 * 断点判定唯一实现（G4 收口）：桌面（≥960）/ 抽屉（640~959）/ 紧凑（<640）。
 *
 * 响应式入口 `useGCS().tier` 与纯函数 `layoutModeFor` 都从这里派生；
 * 任何模块不得再写 `>= LAYOUT_DESKTOP_MIN` / `< LAYOUT_DRAWER_MIN` 比较——
 * 守卫 `viewport-tier-single-source` 扫副本（测试与注释除外）。
 */
export function layoutTierFor(width: number): LayoutTier {
  if (width >= LAYOUT_DESKTOP_MIN) return 'desktop'
  if (width >= LAYOUT_DRAWER_MIN) return 'drawer'
  return 'compact'
}

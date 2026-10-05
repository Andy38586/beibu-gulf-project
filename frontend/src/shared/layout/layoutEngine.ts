// 纯函数布局引擎：面板注册表 × 视口 × 档位 → 绝对矩形；三档同源。
// 桌面档：列内按 order 纵向堆叠（首个贴标题行之下，后续 = 前者底 + PANEL_SPACING）；
// 纵向溢出视口即记入 overflow，strict 下抛错（dev 与单测开启）；
// 抽屉/紧凑档派生为排序列表，交由容器滚动。
// 堆叠口径与 useGCS 的 PPS 同源（x = SAFE_MARGIN / W-SAFE_MARGIN-w，y 按间距累加），
// 现模板 1.25/5.5 只在 cell=80 时与堆叠一致（cell=70/90 差 2.5px），故以堆叠为准。
import {
  PANEL_SPACING,
  SAFE_MARGIN,
  getCellPixelByViewport,
  layoutTierFor,
  type LayoutTier,
} from './config'
import type { PanelSpec, PanelZone } from './panelRegistry'

interface Viewport {
  width: number
  height: number
}

type LayoutMode = LayoutTier

interface PanelRect {
  id: string
  x: number
  y: number
  w: number
  h: number
  zone: PanelZone
  collapsed: boolean
}

interface LayoutResult {
  mode: LayoutMode
  cell: number
  rects: PanelRect[]
  /** 桌面档纵向装不下时按溢出记入此表（strict 下同时抛错） */
  overflow: string[]
  /** 供地图避让的遮挡区（左右由面板派生，上下为 chrome 预留） */
  inset: { left: number; right: number; top: number; bottom: number }
}

export class LayoutOverflowError extends Error {
  constructor(
    readonly panelIds: string[],
    readonly mode: LayoutMode
  ) {
    super(`面板纵向溢出视口（${mode}）：${panelIds.join(', ')}`)
    this.name = 'LayoutOverflowError'
  }
}

interface LayoutOptions {
  strict?: boolean
  collapsed?: Record<string, boolean>
}

/** 标题行占 1 格（AppLayout title 4×1，offset-y=0） */
export const TITLE_H_CELLS = 1
/** 底部导航占 1 格（BottomNavBar h=1，bottom-center，offset-y=0） */
const DOCK_H_CELLS = 1
/** 折叠态面板按 1 格计高 */
const COLLAPSED_H_CELLS = 1

export function layoutModeFor(width: number): LayoutMode {
  return layoutTierFor(width)
}

/** 同 zone 面板按 order 升序（桌面堆叠与 placementsFor 同口径；稳定排序） */
export function orderedZonePanels(panels: PanelSpec[], zone: PanelZone): PanelSpec[] {
  return panels.filter((p) => p.zone === zone).sort((a, b) => a.order - b.order)
}

export function computeLayout(
  panels: PanelSpec[],
  viewport: Viewport,
  modeInput?: LayoutMode,
  options: LayoutOptions = {}
): LayoutResult {
  const mode = modeInput ?? layoutModeFor(viewport.width)
  const cell = getCellPixelByViewport(viewport.width)
  const collapsed = options.collapsed ?? {}
  const rects: PanelRect[] = []
  const overflow: string[] = []
  const isCollapsed = (p: PanelSpec): boolean =>
    Boolean(collapsed[p.id] ?? p.defaultCollapsed ?? false)
  const heightCells = (p: PanelSpec): number => (isCollapsed(p) ? COLLAPSED_H_CELLS : p.h)

  if (mode === 'desktop') {
    // 标题行之下起排：S + 1×cell + S（cell=80 时=120，与现模板 offset-y=1.25 一致）
    const topOffset = SAFE_MARGIN + TITLE_H_CELLS * cell + PANEL_SPACING
    for (const zone of ['left', 'right'] as PanelZone[]) {
      const zonePanels = orderedZonePanels(panels, zone)
      let cursor = topOffset
      for (const p of zonePanels) {
        const w = p.w * cell
        const h = heightCells(p) * cell
        const x = zone === 'left' ? SAFE_MARGIN : viewport.width - SAFE_MARGIN - w
        if (x < SAFE_MARGIN) {
          overflow.push(p.id)
          continue
        }
        rects.push({ id: p.id, x, y: cursor, w, h, zone, collapsed: isCollapsed(p) })
        cursor += h + PANEL_SPACING
      }
    }
    const bottomLimit = viewport.height - SAFE_MARGIN
    const spilling = rects.filter((r) => r.y + r.h > bottomLimit)
    if (spilling.length > 0) {
      overflow.push(...spilling.filter((r) => !overflow.includes(r.id)).map((r) => r.id))
      if (options.strict) throw new LayoutOverflowError(overflow, mode)
    }
  } else {
    // 抽屉档：全部面板按 priority 排序（容器可滚动）；紧凑档：只留 priority=1
    const visible = panels
      .filter((p) => mode !== 'compact' || p.priority === 1)
      .sort((a, b) => a.priority - b.priority || a.order - b.order)
    let y = SAFE_MARGIN + (mode === 'drawer' ? 0 : 0)
    for (const p of visible) {
      const width = Math.min(p.w * cell, viewport.width - SAFE_MARGIN * 2)
      rects.push({
        id: p.id,
        x: mode === 'compact' ? SAFE_MARGIN : viewport.width - SAFE_MARGIN - width,
        y,
        w: width,
        h: heightCells(p) * cell,
        zone: p.zone,
        collapsed: isCollapsed(p),
      })
      y += heightCells(p) * cell + PANEL_SPACING
    }
  }

  const left = rects.filter((r) => r.zone === 'left')
  const right = rects.filter((r) => r.zone === 'right')
  const inset = {
    left: mode === 'desktop' && left.length > 0 ? Math.max(...left.map((r) => r.x + r.w)) + 16 : 0,
    right:
      mode === 'desktop' && right.length > 0
        ? viewport.width - Math.min(...right.map((r) => r.x)) + 16
        : 0,
    top: SAFE_MARGIN + (mode === 'desktop' ? TITLE_H_CELLS * cell : 0),
    bottom: SAFE_MARGIN + DOCK_H_CELLS * cell,
  }
  return { mode, cell, rects, overflow, inset }
}

/** 面板两两重叠检测（单测判据：0 重叠） */
export function findOverlaps(rects: PanelRect[]): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]
      const b = rects[j]
      const overlap = !(
        a.x + a.w <= b.x ||
        b.x + b.w <= a.x ||
        a.y + a.h <= b.y ||
        b.y + b.h <= a.y
      )
      if (overlap) out.push([a.id, b.id])
    }
  }
  return out
}

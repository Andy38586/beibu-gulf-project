// 面板派生位置：注册表 → GCSPanel props 的纯函数桥。
// 为什么存在：offset-y 手写字面量只在 cell=80 时与标题行对齐，
// cell=70/90 时差 2.5px 与标题行重叠；公式收表后多档自洽。
// 口径与 computeLayout 桌面堆叠同源（首个 = 标题行 1 格 + 间距，后续累加 h + 间距）。
import { computed, type ComputedRef } from 'vue'

import { PANEL_SPACING } from './config'
import { TITLE_H_CELLS, orderedZonePanels } from './layoutEngine'
import type { PanelSpec, PanelZone } from './panelRegistry'
import { useGCS } from './useGCS'

/** GCSPanel 定位 props 子集（w/h 必填，锚点只收上下两角） */
interface PanelPlacement {
  w: number
  h: number
  anchor: 'top-left' | 'top-right'
  offsetX: number
  offsetY: number
}

/** 注册表 × cell → 每面板定位（cell 非法时按 80 兜底，与 PPS 同口径） */
export function placementsFor(panels: PanelSpec[], cellPx: number): Record<string, PanelPlacement> {
  const c = cellPx > 0 && Number.isFinite(cellPx) ? cellPx : 80
  const gapCells = PANEL_SPACING / c
  const out: Record<string, PanelPlacement> = {}
  for (const zone of ['left', 'right'] as PanelZone[]) {
    const ordered = orderedZonePanels(panels, zone)
    let cursor = TITLE_H_CELLS + gapCells
    for (const p of ordered) {
      out[p.id] = {
        w: p.w,
        h: p.h,
        anchor: zone === 'left' ? 'top-left' : 'top-right',
        offsetX: 0,
        offsetY: cursor,
      }
      cursor += p.h + gapCells
    }
  }
  return out
}

/** 页面薄 wrapper：跟随全局 cell 档位（与 GCSPanel 内部同源） */
export function usePanelPlacements(
  panels: PanelSpec[]
): ComputedRef<Record<string, PanelPlacement>> {
  const { cellPixel } = useGCS()
  return computed(() => placementsFor(panels, cellPixel.value))
}

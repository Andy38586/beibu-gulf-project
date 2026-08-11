// GCS V2 响应式布局 composable：Cell 尺寸计算 + resize 适配，模块级单例共享
import type { ComputedRef, Ref } from 'vue'
import { computed, ref } from 'vue'

import { logger } from '@/shared/utils/logger'

import {
  CELL_PADDING,
  GAP,
  getCellPixelByViewport,
  LAYOUT_DESKTOP_MIN,
  LAYOUT_DRAWER_MIN,
  PANEL_SPACING,
  SAFE_MARGIN,
} from './config.js'

/** 锚点类型 */
export type Anchor =
  | 'top-left'
  | 'top-right'
  | 'top-center'
  | 'bottom-center'
  | 'bottom-left'
  | 'bottom-right'

/** panelPosition 返回值 */
export interface PanelPosition {
  left: string
  top: string
  width: string
  height: string
  /** 索引签名：兼容 Vue :style 的 CSSProperties 约束 */
  [key: string]: string
}

/** useGCS 返回值 */
export interface UseGCSReturn {
  windowWidth: Ref<number>
  windowHeight: Ref<number>
  cellPixel: Ref<number>
  gap: ComputedRef<number>
  panelSpacing: ComputedRef<number>
  safeMargin: ComputedRef<number>
  padding: number
  showPanels: ComputedRef<boolean>
  showTopArea: ComputedRef<boolean>
  /** 档位 3（<640px）：底部 nav 紧凑化 */
  navCompact: ComputedRef<boolean>
  cell: (w: number, h: number) => { width: string; height: string }
  cellSize: (w: number, h: number) => { width: number; height: number }
  panelContentSize: (w: number, h: number) => { width: number; height: number }
  panelPosition: (
    w: number,
    h: number,
    anchor: Anchor,
    offsetX?: number,
    offsetY?: number
  ) => PanelPosition
  css: Record<string, ComputedRef<string>>
  cell8px: ComputedRef<string>
  cell16px: ComputedRef<string>
  cell40px: ComputedRef<string>
  fontSizeTitle: ComputedRef<string>
  fontSizeBody: ComputedRef<string>
  fontSizeSmall: ComputedRef<string>
}

const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1920)
const windowHeight = ref(typeof window !== 'undefined' ? window.innerHeight : 1080)
const cellPixel = ref(getCellPixelByViewport(windowWidth.value))
let resizeTimer: ReturnType<typeof setTimeout> | null = null
let listenerRegistered = false

function updateCellPixelGlobal(): void {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1920
  windowWidth.value = w
  windowHeight.value = typeof window !== 'undefined' ? window.innerHeight : 1080
  cellPixel.value = getCellPixelByViewport(w)
}

function onResize(): void {
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = setTimeout(updateCellPixelGlobal, 150)
}

function ensureResizeListener(): void {
  if (listenerRegistered || typeof window === 'undefined') return
  window.addEventListener('resize', onResize)
  listenerRegistered = true
}

export function useGCS(): UseGCSReturn {
  ensureResizeListener()

  // 防御：cellPixel/windowWidth 非法时重算（否则路由切换后 Panel 不可见）
  const ww = windowWidth.value
  const cp = cellPixel.value
  if (cp <= 0 || !isFinite(cp) || ww <= 0 || !isFinite(ww)) {
    updateCellPixelGlobal()
    // 若重算后仍无效，设定最低兜底值
    if (cellPixel.value <= 0) cellPixel.value = 80
    if (windowWidth.value <= 0) windowWidth.value = 1920
  }

  // Panel 间距 = 2 × GAP
  const panelSpacing = computed(() => PANEL_SPACING)

  // Panel 到屏幕边缘距离 = PANEL_SPACING
  const safeMargin = computed(() => SAFE_MARGIN)

  // 基础间距单位 = GAP（用于 Grid 参考线计算）
  const gap = computed(() => GAP)

  /**
   * 响应式显隐控制（档位化）
   * showPanels/showTopArea：≥960px（3 个 4-cell 面板宽）；navCompact：<640px
   */
  const showPanels = computed(() => windowWidth.value >= LAYOUT_DESKTOP_MIN)
  const showTopArea = computed(() => windowWidth.value >= LAYOUT_DESKTOP_MIN)
  const navCompact = computed(() => windowWidth.value < LAYOUT_DRAWER_MIN)

  /** w×h 个 Cell 的总尺寸（CSS 字符串） */
  function cell(w: number, h: number): { width: string; height: string } {
    return {
      width: `${w * cellPixel.value}px`,
      height: `${h * cellPixel.value}px`,
    }
  }

  /** w×h 个 Cell 的像素尺寸（数值） */
  function cellSize(w: number, h: number): { width: number; height: number } {
    return {
      width: w * cellPixel.value,
      height: h * cellPixel.value,
    }
  }

  /** Panel 内容区像素尺寸（减去 Cell 内边距） */
  function panelContentSize(w: number, h: number): { width: number; height: number } {
    return {
      width: w * cellPixel.value - 2 * CELL_PADDING,
      height: h * cellPixel.value - 2 * CELL_PADDING,
    }
  }

  /** PPS（面板定位系统）：按锚点和偏移计算 Panel 像素位置 */
  function panelPosition(
    w: number,
    h: number,
    anchor: Anchor,
    offsetX = 0,
    offsetY = 0
  ): PanelPosition {
    // 所有关键值都加兜底，防止 NaN 或 0 导致面板不可见
    const C = cellPixel.value > 0 ? cellPixel.value : 80
    const S = PANEL_SPACING
    const W = windowWidth.value > 0 ? windowWidth.value : 1920
    const H = windowHeight.value > 0 ? windowHeight.value : 1080

    let left: number, top: number

    switch (anchor) {
      case 'top-left':
        left = S + offsetX * C
        top = S + offsetY * C
        break
      case 'top-right':
        left = W - S - (offsetX + w) * C
        top = S + offsetY * C
        break
      case 'top-center':
        left = (W - w * C) / 2
        top = S + offsetY * C
        break
      case 'bottom-center':
        left = (W - w * C) / 2
        top = H - S - (offsetY + h) * C
        break
      case 'bottom-left':
        left = S + offsetX * C
        top = H - S - (offsetY + h) * C
        break
      case 'bottom-right':
        left = W - S - (offsetX + w) * C
        top = H - S - (offsetY + h) * C
        break
      default:
        logger.debug(`[GCS] Unknown anchor: ${anchor}, fallback to top-left`)
        left = S
        top = S
    }

    return {
      left: `${left}px`,
      top: `${top}px`,
      width: `${w * C}px`,
      height: `${h * C}px`,
    }
  }

  /** CSS 尺寸工具集（供 v-bind() 使用） */
  const css = {
    cell8px: computed(() => `${cellPixel.value * 0.1}px`),
    cell16px: computed(() => `${cellPixel.value * 0.2}px`),
    cell40px: computed(() => `${cellPixel.value * 0.5}px`),
    fontSizeTitle: computed(() => '16px'),
    fontSizeBody: computed(() => '14px'),
    fontSizeSmall: computed(() => '12px'),
  }

  return {
    windowWidth,
    windowHeight,
    cellPixel,
    gap,
    panelSpacing,
    safeMargin,
    padding: CELL_PADDING,
    showPanels,
    showTopArea,
    navCompact,
    cell,
    cellSize,
    panelContentSize,
    panelPosition,
    css,
    cell8px: css.cell8px,
    cell16px: css.cell16px,
    cell40px: css.cell40px,
    fontSizeTitle: css.fontSizeTitle,
    fontSizeBody: css.fontSizeBody,
    fontSizeSmall: css.fontSizeSmall,
  }
}

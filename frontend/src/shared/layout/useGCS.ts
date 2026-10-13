// GCS V2 响应式布局 composable：Cell 尺寸计算 + resize 适配，模块级单例共享
import type { ComputedRef, Ref } from 'vue'
import { computed, ref } from 'vue'

import { logger } from '@/shared/utils/logger'

import {
  CELL_PADDING,
  GAP,
  getCellPixelByViewport,
  layoutTierFor,
  PANEL_SPACING,
  type LayoutTier,
} from './config.js'

/** 锚点类型 */
type Anchor =
  | 'top-left'
  | 'top-right'
  | 'top-center'
  | 'bottom-center'
  | 'bottom-left'
  | 'bottom-right'

/** panelPosition 返回值 */
interface PanelPosition {
  left: string
  top: string
  width: string
  height: string
  /** 索引签名：兼容 Vue :style 的 CSSProperties 约束 */
  [key: string]: string
}

/** useGCS 返回值（2026-10-13 收口 A2：删去 6 个全仓零消费成员——见文件内 return 处说明） */
interface UseGCSReturn {
  cellPixel: Ref<number>
  gap: ComputedRef<number>
  padding: number
  showPanels: ComputedRef<boolean>
  showTopArea: ComputedRef<boolean>
  /** 三档档位（断点判定唯一实现 layoutTierFor 的响应式口径） */
  tier: ComputedRef<LayoutTier>
  /** 档位 3（<640px）：底部 nav 紧凑化 */
  navCompact: ComputedRef<boolean>
  cell: (w: number, h: number) => { width: string; height: string }
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

  // 基础间距单位 = GAP（用于 Grid 参考线计算）
  const gap = computed(() => GAP)

  /**
   * 响应式显隐控制（档位化）
   * showPanels/showTopArea：≥960px（3 个 4-cell 面板宽）；navCompact：<640px
   */
  const tier = computed(() => layoutTierFor(windowWidth.value))
  const showPanels = computed(() => tier.value === 'desktop')
  // 顶区与面板同档显示（2026-10-13 收口 A2）：原两处**各自写同一谓词**，
  // 改名或改档漏一处就会出现「面板在、顶区不在」的分叉。改为派生自 showPanels：
  // 保留两个公开名（AppLayout/BottomNavBar 一处都不用改），但只留**一份**谓词。
  const showTopArea = showPanels
  const navCompact = computed(() => tier.value === 'compact')

  /** w×h 个 Cell 的总尺寸（CSS 字符串） */
  function cell(w: number, h: number): { width: string; height: string } {
    return {
      width: `${w * cellPixel.value}px`,
      height: `${h * cellPixel.value}px`,
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

  // 2026-10-13 收口 A2：删去 windowWidth/windowHeight/panelSpacing/safeMargin/
  // cellSize/panelContentSize 六个成员——全仓（含测试）零解构、零点号访问，
  // 属"返回面看起来比真实可用面大"的负资产。内部若仍需这些值，各自的 ref/computed
  // 保留在本作用域内（不对外即不再是契约）。
  return {
    cellPixel,
    gap,
    padding: CELL_PADDING,
    showPanels,
    showTopArea,
    tier,
    navCompact,
    cell,
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

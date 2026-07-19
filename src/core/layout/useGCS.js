/**
 * GCS V2 响应式布局 composable
 *
 * 提供基于 Cell 的尺寸计算函数，并监听窗口 resize 事件动态调整 CELL_PIXEL。
 * 所有使用 GCS 的组件都应通过此 composable 获取尺寸，禁止直接引用 config.js 中的常量。
 *
 * V2 变更：
 * - 新增 panelSpacing 和 safeMargin 返回值
 * - 新增 windowHeight 响应式变量
 * - 新增 panelPosition 函数（PPS 引擎核心）
 */

import { computed, onMounted, onUnmounted, ref } from 'vue'
import { CELL_PADDING, GAP, PANEL_SPACING, SAFE_MARGIN, getCellPixelByViewport } from './config.js'

/**
 * 使用 GCS 布局系统
 * @returns {{
 *   windowWidth: import('vue').Ref<number>,
 *   windowHeight: import('vue').Ref<number>,
 *   cellPixel: import('vue').Ref<number>,
 *   gap: import('vue').ComputedRef<number>,
 *   panelSpacing: import('vue').ComputedRef<number>,
 *   safeMargin: import('vue').ComputedRef<number>,
 *   padding: number,
 *   showPanels: import('vue').ComputedRef<boolean>,
 *   showTopArea: import('vue').ComputedRef<boolean>,
 *   cell: (w: number, h: number) => { width: string, height: string },
 *   cellSize: (w: number, h: number) => { width: number, height: number },
 *   panelContentSize: (w: number, h: number) => { width: number, height: number },
 *   panelPosition: (w: number, h: number, anchor: string, offsetX?: number, offsetY?: number) => {
 *     left: string, top: string, width: string, height: string
 *   }
 * }}
 */
export function useGCS() {
  // 当前视口宽度
  const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1920)

  // 当前视口高度（V2 新增，用于 PPS 计算）
  const windowHeight = ref(typeof window !== 'undefined' ? window.innerHeight : 1080)

  // 当前 Cell 像素值，根据视口宽度动态查表
  const cellPixel = ref(getCellPixelByViewport(windowWidth.value))

  // Panel 间距 = 2 × GAP = 20px（V2 新增）
  const panelSpacing = computed(() => PANEL_SPACING)

  // Panel 到 Canvas 边缘距离 = PANEL_SPACING = 20px（V2 新增）
  const safeMargin = computed(() => SAFE_MARGIN)

  // 基础间距单位 = GAP = 10px（V2 保留：用于 Grid 参考线计算）
  const gap = computed(() => GAP)

  /**
   * 响应式显隐控制
   * - showPanels: 是否显示左右 Panel 组（可视化 / 图层控制 / 结果展示）
   * - showTopArea: 是否显示顶部 Panel 组（Title + 城市按钮）
   * - 底部导航条始终显示，确保任何尺寸下都能切换业务
   */
  const showPanels = computed(() => windowWidth.value >= 768)
  const showTopArea = computed(() => windowWidth.value >= 768)

  /**
   * 计算 w×h 个 Cell 占据的总尺寸（CSS 字符串格式）
   * @param {number} w - 横向 Cell 数
   * @param {number} h - 纵向 Cell 数
   * @returns {{ width: string, height: string }}
   */
  function cell(w, h) {
    return {
      width: `${w * cellPixel.value}px`,
      height: `${h * cellPixel.value}px`,
    }
  }

  /**
   * 计算 w×h 个 Cell 占据的像素尺寸（数值格式）
   * @param {number} w - 横向 Cell 数
   * @param {number} h - 纵向 Cell 数
   * @returns {{ width: number, height: number }}
   */
  function cellSize(w, h) {
    return {
      width: w * cellPixel.value,
      height: h * cellPixel.value,
    }
  }

  /**
   * 计算 Panel 内部内容区域的像素尺寸（数值格式）
   * @param {number} w - 横向 Cell 数
   * @param {number} h - 纵向 Cell 数
   * @returns {{ width: number, height: number }}
   */
  function panelContentSize(w, h) {
    return {
      width: w * cellPixel.value - 2 * CELL_PADDING,
      height: h * cellPixel.value - 2 * CELL_PADDING,
    }
  }

  /**
   * Panel Position System - 根据锚点和偏移计算 Panel 像素位置
   *
   * @param {number} w - Panel 宽度（Cell 单位）
   * @param {number} h - Panel 高度（Cell 单位）
   * @param {string} anchor - 锚点: 'top-left' | 'top-right' | 'top-center' |
   *                          'bottom-center' | 'bottom-left' | 'bottom-right'
   * @param {number} offsetX - 水平偏移（Cell 单位，默认 0）
   * @param {number} offsetY - 垂直偏移（Cell 单位，默认 0）
   * @returns {{ left: string, top: string, width: string, height: string }}
   *
   * 公式说明：
   *   C = cellPixel.value（当前 Cell 像素值）
   *   S = PANEL_SPACING（Panel 间距 = 20px）
   *   W = windowWidth.value（视口宽度）
   *   H = windowHeight.value（视口高度）
   *
   *   top-left:      left = S + offsetX*C,          top = S + offsetY*C
   *   top-right:     left = W - S - (offsetX+w)*C,  top = S + offsetY*C
   *   top-center:    left = (W - w*C) / 2,          top = S + offsetY*C
   *   bottom-center: left = (W - w*C) / 2,          top = H - S - (offsetY+h)*C
   *   bottom-left:   left = S + offsetX*C,          top = H - S - (offsetY+h)*C
   *   bottom-right:  left = W - S - (offsetX+w)*C,  top = H - S - (offsetY+h)*C
   */
  function panelPosition(w, h, anchor, offsetX = 0, offsetY = 0) {
    const C = cellPixel.value
    const S = PANEL_SPACING
    const W = windowWidth.value
    const H = windowHeight.value

    let left, top

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
        // AUDIT-017 (错误): 仅在开发环境输出警告
        if (import.meta.env.DEV) {
          console.warn(`[GCS] Unknown anchor: ${anchor}, fallback to top-left`)
        }
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

  let resizeTimer = null

  /**
   * 根据当前视口更新 CELL_PIXEL 和视口尺寸
   */
  function updateCellPixel() {
    windowWidth.value = window.innerWidth
    windowHeight.value = window.innerHeight // V2 新增
    cellPixel.value = getCellPixelByViewport(windowWidth.value)
  }

  /**
   * 防抖 resize 处理（150ms）
   */
  function onResize() {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(updateCellPixel, 150)
  }

  onMounted(() => {
    window.addEventListener('resize', onResize)
  })

  onUnmounted(() => {
    window.removeEventListener('resize', onResize)
    clearTimeout(resizeTimer)
  })

  return {
    windowWidth,
    windowHeight, // V2 新增
    cellPixel,
    gap,
    panelSpacing, // V2 新增
    safeMargin, // V2 新增
    padding: CELL_PADDING,
    showPanels,
    showTopArea,
    cell,
    cellSize,
    panelContentSize,
    panelPosition, // V2 新增：PPS 引擎核心函数
  }
}

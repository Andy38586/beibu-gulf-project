// GCS V2 响应式布局 composable：Cell 尺寸计算 + resize 适配，模块级单例共享
import { computed, ref } from 'vue'
import { CELL_PADDING, GAP, PANEL_SPACING, SAFE_MARGIN, getCellPixelByViewport } from './config.js'

const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1920)
const windowHeight = ref(typeof window !== 'undefined' ? window.innerHeight : 1080)
const cellPixel = ref(getCellPixelByViewport(windowWidth.value))
let resizeTimer = null
let listenerRegistered = false

function updateCellPixel() {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1920
  windowWidth.value = w
  windowHeight.value = typeof window !== 'undefined' ? window.innerHeight : 1080
  cellPixel.value = getCellPixelByViewport(w)
}

function onResize() {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(updateCellPixel, 150)
}

function ensureResizeListener() {
  if (listenerRegistered || typeof window === 'undefined') return
  window.addEventListener('resize', onResize)
  listenerRegistered = true
}

export function useGCS() {
  ensureResizeListener()

  // 防御：cellPixel/windowWidth 非法时重算，解决路由切换后 Panel 不可见
  const ww = windowWidth.value
  const cp = cellPixel.value
  if (cp <= 0 || !isFinite(cp) || ww <= 0 || !isFinite(ww)) {
    updateCellPixel()
    // 若重算后仍无效，设定最低兜底值
    if (cellPixel.value <= 0) cellPixel.value = 80
    if (windowWidth.value <= 0) windowWidth.value = 1920
  }

  // Panel 间距 = 2 × GAP = 20px（V2 新增）
  const panelSpacing = computed(() => PANEL_SPACING)

  // Panel 到 Canvas 边缘距离 = PANEL_SPACING = 20px（V2 新增）
  const safeMargin = computed(() => SAFE_MARGIN)

  // 基础间距单位 = GAP = 10px（用于 Grid 参考线计算）
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
    // 所有关键值都加兜底，防止 NaN 或 0 导致面板不可见
    const C = cellPixel.value > 0 ? cellPixel.value : 80
    const S = PANEL_SPACING
    const W = windowWidth.value > 0 ? windowWidth.value : 1920
    const H = windowHeight.value > 0 ? windowHeight.value : 1080

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
        // 仅在开发环境输出警告
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

  /**
   * CSS 尺寸工具集（用于 v-bind() 场景）
   * 提供常用尺寸的字符串格式，避免组件重复写计算属性
   * 使用方式：const { css } = useGCS(); 在 CSS 中 v-bind(css.cell8px)
   */
  const css = {
    // 间距尺寸
    /** 8px = 0.1 cell */
    cell8px: computed(() => `${cellPixel.value * 0.1}px`),
    /** 16px = 0.2 cell */
    cell16px: computed(() => `${cellPixel.value * 0.2}px`),
    /** 40px = 0.5 cell */
    cell40px: computed(() => `${cellPixel.value * 0.5}px`),
    // 字号固定 px，与 cell 网格解耦（GCS_V2 规范：16/14/12px）
    fontSizeTitle: computed(() => '16px'),
    fontSizeBody: computed(() => '14px'),
    fontSizeSmall: computed(() => '12px'),
  }

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
    css, // V2 新增：CSS v-bind() 专用工具（保留向后兼容）
    // V2 优化：直接平铺 CSS 变量，避免组件二次解构
    cell8px: css.cell8px,
    cell16px: css.cell16px,
    cell40px: css.cell40px,
    fontSizeTitle: css.fontSizeTitle,
    fontSizeBody: css.fontSizeBody,
    fontSizeSmall: css.fontSizeSmall,
  }
}

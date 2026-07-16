/**
 * GCS 响应式布局 composable
 *
 * 提供基于 Cell 的尺寸计算函数，并监听窗口 resize 事件动态调整 CELL_PIXEL。
 * 所有使用 GCS 的组件都应通过此 composable 获取尺寸，禁止直接引用 config.js 中的常量。
 */

import { computed, onMounted, onUnmounted, ref } from 'vue'
import { CELL_PADDING, getCellPixelByViewport } from './config.js'

/**
 * 使用 GCS 布局系统
 * @returns {{
 *   windowWidth: import('vue').Ref<number>,
 *   cellPixel: import('vue').Ref<number>,
 *   panelPixel: import('vue').ComputedRef<number>,
 *   gap: import('vue').ComputedRef<number>,
 *   padding: number,
 *   cell: (w: number, h: number) => { width: string, height: string },
 *   panel: (w: number, h: number) => { width: string, height: string }
 * }}
 */
export function useGCS() {
  // 当前视口宽度
  const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1920)

  // 当前 Cell 像素值，根据视口宽度动态查表
  const cellPixel = ref(getCellPixelByViewport(windowWidth.value))

  // Panel 像素值 = Cell - 两侧内边距
  const panelPixel = computed(() => cellPixel.value - CELL_PADDING * 2)

  // Panel 间距 = 两侧内边距之和
  const gap = computed(() => CELL_PADDING * 2)

  /**
   * 响应式显隐控制
   * - showPanels: 是否显示左右容器（可视化 / 图层控制 / 结果展示）
   * - showTopArea: 是否显示顶部功能区
   * - 底部导航条始终显示，确保任何尺寸下都能切换业务
   */
  const showPanels = computed(() => windowWidth.value >= 768)
  const showTopArea = computed(() => windowWidth.value >= 768)

  /**
   * 计算 w×h 个 Cell 占据的总尺寸（含内边距）
   * @param {number} w - 横向 Cell 数
   * @param {number} h - 纵向 Cell 数
   */
  function cell(w, h) {
    return {
      width: `${w * cellPixel.value}px`,
      height: `${h * cellPixel.value}px`,
    }
  }

  /**
   * 计算 w×h 个 Panel 占据的总尺寸（含间隙）
   * @param {number} w - 横向 Panel 数
   * @param {number} h - 纵向 Panel 数
   */
  function panel(w, h) {
    return {
      width: `${w * panelPixel.value + (w - 1) * gap.value}px`,
      height: `${h * panelPixel.value + (h - 1) * gap.value}px`,
    }
  }

  let resizeTimer = null

  /**
   * 根据当前视口更新 CELL_PIXEL
   */
  function updateCellPixel() {
    windowWidth.value = window.innerWidth
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
    cellPixel,
    panelPixel,
    gap,
    padding: CELL_PADDING,
    showPanels,
    showTopArea,
    cell,
    panel,
  }
}

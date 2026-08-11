/**
 * GCS（网格化布局系统）组件类型定义 - Panel
 */

// ===== GCSPanel =====

export interface GCSPanelProps {
  /** 宽度（Cell 单位） */
  w: number
  /** 高度（Cell 单位） */
  h: number
  /** 锚点位置 */
  anchor: 'top-left' | 'top-right' | 'top-center' | 'bottom-center' | 'bottom-left' | 'bottom-right'
  /** X 轴偏移（Cell 单位，可为小数） */
  offsetX?: number
  /** Y 轴偏移（Cell 单位，可为小数） */
  offsetY?: number
  /** 自定义样式类名 */
  panelClass?: string
}

export interface GCSPanelEmits {
  (_e: 'panel-ready', _el: HTMLElement): void
  (_e: 'panel-resize', _size: { w: number; h: number }): void
}

// ===== GCSButton =====

export interface GCSButtonProps {
  label: string
  icon?: string
  disabled?: boolean
  active?: boolean
  w?: number
  h?: number
}

export interface GCSButtonEmits {
  (_e: 'click'): void
}

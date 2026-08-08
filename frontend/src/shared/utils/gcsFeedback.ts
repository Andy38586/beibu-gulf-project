/**
 * GCS 反馈单例（2026-08-08 打磨：替换 ElMessage/ElMessageBox 为 GCS 标准）
 *
 * 模块级单例状态——GCSModal / GCSToast 组件订阅渲染，任意代码（组件 / 工具函数）
 * 通过 showModal / showToast / closeModal 编程式触发，替代 Element Plus 的
 * ElMessageBox.confirm / ElMessage（脱离 Element 反馈层，视觉走 GCS 网格与 --GCS-* 变量）。
 *
 * 规格（用户定）：
 * - Modal：宽 4cell 高 3cell + 顶部 × 关闭 + 两个 1.8×0.8 cell 按钮（主按钮 + 取消）
 * - Toast：2cell 宽 1cell 高轻提示，自动消失
 */
import { reactive } from 'vue'

/** Modal 模式：error（重试/取消）/ login（去登录/取消）/ confirm（确定/取消） */
export type GCSModalMode = 'error' | 'login' | 'confirm'
/** Toast 类型：语义色对应 --GCS-color-success/warning/error */
export type GCSToastType = 'success' | 'warning' | 'error'

interface GCSModalState {
  visible: boolean
  message: string
  mode: GCSModalMode
  /** 主按钮文案（按 mode 有默认：error→重试 / login→去登录 / confirm→确定） */
  confirmText: string
  /** 主按钮回调（confirm 模式必传；error 模式由调用方决定是否传） */
  onConfirm: (() => void) | null
}

interface GCSToastItem {
  id: number
  message: string
  type: GCSToastType
}

export const gcsModalState: GCSModalState = reactive({
  visible: false,
  message: '',
  mode: 'error',
  confirmText: '重试',
  onConfirm: null,
})

export const gcsToastState: { items: GCSToastItem[] } = reactive({ items: [] })

let toastSeq = 0

/** 默认主按钮文案（按模式） */
function defaultConfirmText(mode: GCSModalMode): string {
  if (mode === 'login') return '去登录'
  if (mode === 'confirm') return '确定'
  return '重试'
}

/** 打开确认/提示弹窗（编程式，GCSModal 组件订阅渲染） */
export function showModal(opts: {
  message: string
  mode?: GCSModalMode
  confirmText?: string
  onConfirm?: () => void
}): void {
  gcsModalState.message = opts.message
  gcsModalState.mode = opts.mode ?? 'error'
  gcsModalState.confirmText = opts.confirmText ?? defaultConfirmText(gcsModalState.mode)
  gcsModalState.onConfirm = opts.onConfirm ?? null
  gcsModalState.visible = true
}

/** 关闭弹窗（取消按钮 / 顶部 × / 遮罩点击） */
export function closeModal(): void {
  gcsModalState.visible = false
  gcsModalState.onConfirm = null
}

/** 触发主按钮（重试/去登录/确定）——组件调用，先关弹窗再执行回调 */
export function confirmModal(): void {
  const cb = gcsModalState.onConfirm
  closeModal()
  cb?.()
}

/** 轻提示 toast（2×1 cell，GCSToast 组件订阅渲染并自动消失） */
export function showToast(message: string, type: GCSToastType = 'success'): void {
  gcsToastState.items.push({ id: ++toastSeq, message, type })
}

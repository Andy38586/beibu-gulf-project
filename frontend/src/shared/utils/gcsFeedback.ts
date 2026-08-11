/**
 * GCS 反馈单例：GCSModal/GCSToast 组件订阅渲染，任意代码（组件/工具函数）经
 * showModal/showToast/closeModal 编程式触发，替代 Element Plus 的 ElMessageBox/ElMessage，
 * 视觉走 GCS 网格与 --GCS-* 变量。
 * 规格：Modal 4×3 cell；Toast 2×1 cell 自动消失。
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

// toast 队列上限 4：一号位=最新（顶部），四号位=最老；第 5 条触发时最老淡出
const MAX_TOAST_COUNT = 4

/** 轻提示 toast（2×0.5 cell，GCSToast 组件订阅渲染并自动消失） */
export function showToast(message: string, type: GCSToastType = 'success'): void {
  // 超出上限移除最老（数组尾部），TransitionGroup 自动播放 leave 淡出
  if (gcsToastState.items.length >= MAX_TOAST_COUNT) {
    gcsToastState.items.pop()
  }
  // 新 toast unshift 到顶部，老 toast 顺移下移
  gcsToastState.items.unshift({ id: ++toastSeq, message, type })
}

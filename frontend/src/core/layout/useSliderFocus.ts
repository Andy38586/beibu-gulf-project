/**
 * useSliderFocus - 滑块专注模式（安卓控制中心风格，2026-08-09 用户决策）
 *
 * 场景：抽屉/屏幕上同时有多个面板时，拖动滑块会被其他面板干扰视觉。
 * 行为：滑块按下（pointerdown）→ 进入专注模式，其余面板全透明，只保留滑块所在面板；
 *       松手/取消（pointerup/pointercancel）→ 恢复。底部 nav 不受影响。
 * 实现：模块级单例。AppLayout 监听 active 切换根节点 class（slider-focus-mode），
 *       并给滑块所在面板标记 slider-focus-panel；滑块组件在操作时调用 begin/end。
 */
import { ref } from 'vue'

/** 专注模式是否激活 */
const active = ref(false)
/** 当前滑块所在面板元素（closest('.GCS-panel')） */
const activePanel = ref<HTMLElement | null>(null)

export function useSliderFocus() {
  /** 滑块按下：记录所在面板并进入专注模式 */
  function beginSliderFocus(el: HTMLElement | null): void {
    activePanel.value = el?.closest('.GCS-panel') ?? null
    active.value = true
  }
  /** 滑块松手/取消：退出专注模式 */
  function endSliderFocus(): void {
    active.value = false
    activePanel.value = null
  }
  return { active, activePanel, beginSliderFocus, endSliderFocus }
}

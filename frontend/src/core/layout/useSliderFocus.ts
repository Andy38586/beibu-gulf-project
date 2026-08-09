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

import { LAYOUT_DESKTOP_MIN } from '@/shared/layout/config'

/** 专注模式是否激活 */
const active = ref(false)
/** 当前滑块所在面板元素（closest('.GCS-panel')） */
const activePanel = ref<HTMLElement | null>(null)

export function useSliderFocus() {
  /**
   * 滑块按下：记录所在面板并进入专注模式。
   * 档位 1（≥960px，3 面板宽）无遮挡，专注模式不生效（2026-08-09 用户决策）。
   * 同时在 document 上注册 pointerup/pointercancel 兜底——组件上的 @pointerup
   * 可能因滑块组件卸载（v-if 切换）/事件被内部吞掉而丢失，导致专注模式卡死
   * （body 常驻 slider-focus-mode，所有面板透明，"面板消失"假象，2026-08-09 实测）。
   */
  function beginSliderFocus(el: HTMLElement | null): void {
    if (typeof window !== 'undefined' && window.innerWidth >= LAYOUT_DESKTOP_MIN) return
    document.removeEventListener('pointerup', endSliderFocus)
    document.removeEventListener('pointercancel', endSliderFocus)
    activePanel.value = el?.closest('.GCS-panel') ?? null
    active.value = true
    document.addEventListener('pointerup', endSliderFocus)
    document.addEventListener('pointercancel', endSliderFocus)
  }
  /** 滑块松手/取消：退出专注模式（幂等，document 兜底与组件事件共用） */
  function endSliderFocus(): void {
    document.removeEventListener('pointerup', endSliderFocus)
    document.removeEventListener('pointercancel', endSliderFocus)
    active.value = false
    activePanel.value = null
  }
  return { active, activePanel, beginSliderFocus, endSliderFocus }
}

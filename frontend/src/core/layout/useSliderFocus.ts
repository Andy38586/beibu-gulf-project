/**
 * useSliderFocus - 滑块专注模式（安卓控制中心风格）
 * 多面板同时显示时拖动滑块会被其他面板干扰视觉：按下进入专注模式，
 * 其余面板透明、只保留滑块所在面板，松手恢复（底部 nav 不受影响）。
 * 模块级单例：AppLayout 监听 active 切换 class，滑块组件调用 begin/end。
 */
import { onScopeDispose, ref } from 'vue'

import { LAYOUT_DESKTOP_MIN } from '@/shared/layout/config'

/** 专注模式是否激活 */
const active = ref(false)
/** 当前滑块所在面板元素（closest('.GCS-panel')） */
const activePanel = ref<HTMLElement | null>(null)

export function useSliderFocus() {
  /**
   * 滑块按下：记录所在面板并进入专注模式。
   * 桌面档位（≥960px，3 面板宽）无遮挡，不生效。
   * 在 document 上注册 pointerup/pointercancel 兜底：组件事件可能因卸载或内部
   * 吞掉而丢失，否则专注模式会卡死（所有面板透明）。
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
  /** 滑块松手/取消：退出专注模式（幂等） */
  function endSliderFocus(): void {
    document.removeEventListener('pointerup', endSliderFocus)
    document.removeEventListener('pointercancel', endSliderFocus)
    active.value = false
    activePanel.value = null
  }
  // 作用域卸载兜底——调用方组件卸载时 document 监听随 endSliderFocus 解绑，
  // 防止监听残留（专注模式卡死）
  onScopeDispose(endSliderFocus)
  return { active, activePanel, beginSliderFocus, endSliderFocus }
}

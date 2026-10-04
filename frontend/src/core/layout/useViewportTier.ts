/**
 * useViewportTier — 响应式三档档位（v4-S10，总纲 §9.2，对齐 shared/layout/config 断点）。
 *
 * - desktop：≥960px（cell 80/90），完整拖拽
 * - drawer ：640~959px（cell 70，面板收进侧滑抽屉——MobileDrawer），完整拖拽
 * - compact：<640px，自由拖拽**降级**为长按弹"停靠到后台"（触屏无拖拽语义）
 *
 * 单 resize 监听挂模块级（App 生命周期同长，常驻壳层语义，不随组件卸载拆除）；
 * width 是 ref，档位为 computed——消费方拿到的是响应式档位。
 */
import { computed, type ComputedRef, onUnmounted, ref } from 'vue'

import { LAYOUT_DESKTOP_MIN, LAYOUT_DRAWER_MIN } from '@/shared'

type ViewportTier = 'desktop' | 'drawer' | 'compact'

const width = ref(typeof window !== 'undefined' ? window.innerWidth : 1280)
let listenerCount = 0

function onResize(): void {
  width.value = window.innerWidth
}

export function useViewportTier(): ComputedRef<ViewportTier> {
  if (typeof window !== 'undefined') {
    if (listenerCount === 0) window.addEventListener('resize', onResize)
    listenerCount++
    onUnmounted(() => {
      listenerCount--
      if (listenerCount === 0) window.removeEventListener('resize', onResize)
    })
  }
  return computed(() => {
    if (width.value >= LAYOUT_DESKTOP_MIN) return 'desktop'
    if (width.value >= LAYOUT_DRAWER_MIN) return 'drawer'
    return 'compact'
  })
}

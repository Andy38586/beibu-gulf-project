/**
 * useViewportTier — 响应式三档档位（v4-S10，总纲 §9.2，对齐 shared/layout/config 断点）。
 *
 * - desktop：≥960px（cell 80/90），完整拖拽
 * - drawer ：640~959px（cell 70，面板收进侧滑抽屉——MobileDrawer），完整拖拽
 * - compact：<640px，自由拖拽**降级**为长按弹"停靠到后台"（触屏无拖拽语义）
 *
 * G4 收口：断点判定唯一实现在 `shared/layout/config.layoutTierFor`，响应式入口是
 * `useGCS().tier`（模块级单例 resize + 150ms 防抖）。本 composable 只是消费别名——
 * 不再注册第二份 resize 监听、不再自己写断点比较（修前为第二实现，边界瞬态可分叉）。
 */
import type { ComputedRef } from 'vue'

import type { LayoutTier } from '@/shared'
import { useGCS } from '@/shared'

export function useViewportTier(): ComputedRef<LayoutTier> {
  return useGCS().tier
}

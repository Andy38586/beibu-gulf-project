/**
 * navConfig - 底部导航项配置（c023：core/layout 业务污染治理）
 * 职责：提供导航项的注册机制，由业务层（App.vue）注入具体路由，
 * core/layout 不再硬编码业务路由。
 */

import { readonly, ref } from 'vue'

/** 导航项结构 */
export interface NavItem {
  /** 路由路径 */
  path: string
  /** 显示标签 */
  label: string
  /** 图标（emoji 或字符） */
  icon?: string
  /** 是否禁用（未实现业务占位） */
  disabled?: boolean
}

/** 内部可写列表 */
const _navItems = ref<NavItem[]>([])

/** 只读导航项列表（供 BottomNavBar 消费） */
export const navItems = readonly(_navItems)

/**
 * 注册导航项（业务层调用，通常在 App.vue setup 中一次性注册）
 * @param items 导航项数组
 */
export function registerNavItems(items: NavItem[]): void {
  _navItems.value = items
}

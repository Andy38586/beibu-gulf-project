/**
 * navConfig - 底部导航项配置（2026-08-09 重构恢复：core/layout 不引 business 的分层铁律）
 * 职责：提供导航项注册机制，由业务层入口（App.vue，可引 business/manifest）注入，
 * core/layout 只消费本文件（core 内部），杜绝 core → business 依赖与循环。
 * 项类型：
 * - home/profile：静态项（路由 / 与 /profile）
 * - business：业务模块项（由 App.vue 从 business/manifest 生成）
 * 消费方：BottomNavBar（dock 渲染）、AppLayout（抽屉业务行）
 */

import { readonly, ref } from 'vue'

/** 导航项类型 */
export type NavItemType = 'home' | 'profile' | 'business'

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
  /** 项类型：决定 dock/抽屉的渲染分支 */
  type: NavItemType
}

/** 内部可写列表 */
const _navItems = ref<NavItem[]>([])

/** 只读导航项列表（供 BottomNavBar / AppLayout 消费） */
export const navItems = readonly(_navItems)

/**
 * 注册导航项（业务层入口调用，App.vue setup 中一次性注册）
 * @param items 导航项数组（含 home / business / profile）
 */
export function registerNavItems(items: NavItem[]): void {
  _navItems.value = items
}

/**
 * GCS（网格化布局系统）组件类型定义 - Dock / BottomNavBar
 */

export interface NavItem {
  path: string
  label: string
  icon: string
  disabled?: boolean
  engine?: '2d' | '3d'
}

export interface BottomNavBarProps {
  items: NavItem[]
  currentPath: string
}

export interface BottomNavBarEmits {
  (_e: 'navigate', _path: string): void
}

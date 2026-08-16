/**
 * useMobileDrawer - 抽屉开关的共享状态（模块级单例）
 * AppLayout 与 MobileDrawer 共享同一布尔态，保证任意入口开关行为一致；
 * 面板内容由 AppLayout 经 slot（Vue 插槽）注入，不耦合业务数据。
 */
import { ref, type Ref } from 'vue'

const drawerOpen = ref(false)

/** 返回契约（816-专项3-0816-13：显式化，防重构时签名静默漂移） */
export interface UseMobileDrawerReturn {
  drawerOpen: Ref<boolean>
  openDrawer: () => void
  closeDrawer: () => void
  toggleDrawer: () => void
}

export function useMobileDrawer(): UseMobileDrawerReturn {
  function openDrawer(): void {
    drawerOpen.value = true
  }
  function closeDrawer(): void {
    drawerOpen.value = false
  }
  function toggleDrawer(): void {
    drawerOpen.value = !drawerOpen.value
  }
  return { drawerOpen, openDrawer, closeDrawer, toggleDrawer }
}

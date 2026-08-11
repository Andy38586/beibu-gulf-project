/**
 * useMobileDrawer - 抽屉开关的共享状态（模块级单例）
 * AppLayout 与 MobileDrawer 共享同一布尔态，保证任意入口开关行为一致；
 * 面板内容由 AppLayout 经 slot（Vue 插槽）注入，不耦合业务数据。
 */
import { ref } from 'vue'

const drawerOpen = ref(false)

export function useMobileDrawer() {
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

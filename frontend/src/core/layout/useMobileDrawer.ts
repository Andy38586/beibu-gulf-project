/**
 * useMobileDrawer - 移动端业务面板抽屉的共享状态
 *
 * 模块级单例：AppLayout（渲染 FAB + 抽屉）与 MobileDrawer（开关）共享同一状态，
 * 保证任意入口打开/关闭行为一致。
 *
 * 仅管理「开/关」布尔态；面板内容由 AppLayout 通过 slot 注入，
 * 不在此处耦合任何业务数据。
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

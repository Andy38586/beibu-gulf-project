import { onBeforeRouteLeave } from 'vue-router'

/**
 * 个人中心往返快照守卫（原三业务页各自逐字复制同一段 onBeforeRouteLeave）：
 * 去 /profile（登录）→ save()；离开其它路由 → clear()。
 *
 * 快照负载与恢复动作页面专属（各 store 结构不同），此处只收口"何时保存/何时清理"
 * 这个决策点；页面 onMounted 仍自行处理恢复分支。
 * 业务背景：登录/个人中心往返是唯一被允许保留页面状态的路径（跳转后返回要还原现场）。
 */
export function useProfileSnapshot(handlers: { save: () => void; clear?: () => void }): void {
  onBeforeRouteLeave((to) => {
    if (isProfilePath(to.path)) {
      handlers.save()
    } else {
      handlers.clear?.()
    }
  })
}

/** 个人中心路径判定（独立纯函数便于单测；登录上下文里可能带 redirect 参数，取 path 比对） */
export function isProfilePath(path: string): boolean {
  return path === '/profile'
}

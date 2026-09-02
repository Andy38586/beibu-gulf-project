import { onUnmounted } from 'vue'

/**
 * 等待渲染器就绪后执行回调（有限次重试，不无限轮询）。
 * 收敛原三处同构实现：App.vue waitForRenderer、SiteSelectionPage tryZoom、
 * useCityScope interval 绑定——均为"渲染器异步初始化晚于组件挂载"场景，
 * 统一 500ms 间隔、最多 10 次重试；组件卸载自动取消，不悬挂定时器。
 * 返回取消函数（onUnmounted 已自动调用；长生命周期组件也可手动提前取消）。
 */
export function useWaitForRenderer(ready: () => unknown, callback: () => void): () => void {
  const MAX_RETRIES = 10
  const DELAY_MS = 500
  let retries = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const tryRun = () => {
    if (ready()) {
      callback()
      return
    }
    if (retries < MAX_RETRIES) {
      retries += 1
      timer = setTimeout(tryRun, DELAY_MS)
    }
  }

  tryRun()
  onUnmounted(cancel)
  return cancel
}

/**
 * useLatestRequest — 请求竞态守卫（新请求优先 + 取消）。
 * 收口各业务页手写的 AbortController 管理（预测事务/选址竞态/方案列表/洪涝分析），统一一套实现。
 * - createSignal：abort 上一个在途请求并返回新 signal（快速连点时旧响应丢弃）
 * - isLatest：await 后检查响应是否仍最新，过期不写回
 * - getCurrentSignal：透传在途取消信号给子调用（如水域坐标加载与主分析共享取消）
 * - cancel：卸载时取消在途请求
 */

/** 返回契约（816-专项3-0816-13：显式化，防重构时签名静默漂移） */
export interface UseLatestRequestReturn {
  createSignal: () => AbortSignal
  isLatest: (signal: AbortSignal) => boolean
  getCurrentSignal: () => AbortSignal | undefined
  cancel: () => void
}

export function useLatestRequest(): UseLatestRequestReturn {
  let controller: AbortController | null = null

  /** 新请求优先：取消旧请求并返回新 signal */
  function createSignal(): AbortSignal {
    controller?.abort()
    controller = new AbortController()
    return controller.signal
  }

  /** 判断 signal 是否仍最新：await 期间又发新请求则本响应过期，不写回 */
  function isLatest(signal: AbortSignal): boolean {
    return controller !== null && signal === controller.signal
  }

  /** 只读当前在途 signal（未发起请求时为 undefined），不创建新 controller */
  function getCurrentSignal(): AbortSignal | undefined {
    return controller?.signal
  }

  /** 取消在途请求并清引用（组件卸载时调用，静默） */
  function cancel(): void {
    controller?.abort()
    controller = null
  }

  return { createSignal, isLatest, getCurrentSignal, cancel }
}

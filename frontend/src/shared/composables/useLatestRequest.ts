/**
 * useLatestRequest — 通用请求竞态守卫（2026-08-08 请求封装统一）
 *
 * 背景：useForecastRequest（预测事务）/ useSiteAnalysisApi（选址竞态）/ usePlans（方案列表）/
 * FloodAnalysisPage（洪涝两路）各自手写 AbortController 管理（新请求 abort 旧请求 + 卸载取消），
 * 同一模式多份实现、语义漂移。此处收敛为单一实现（"取消 + 竞态"一套），业务层只保留业务语义
 * （事务 ID / 401 处理 / loading 状态等）。
 *
 * 职责：
 * - createSignal：新请求优先——abort 上一个在途请求并返回新 signal
 * - isLatest：判断 signal 是否仍是最新请求（旧响应晚到时不写回）
 * - getCurrentSignal：只读当前在途 signal（未发起请求时 undefined）——用于把现有请求的
 *   取消信号透传给子调用（如洪涝水域坐标加载与主分析共享取消）
 * - cancel：取消在途请求并清引用（组件卸载时调用）
 */
export function useLatestRequest() {
  let controller: AbortController | null = null

  /**
   * 新请求优先：取消旧请求并返回新 signal
   * 快速连点/状态频繁切换时，旧请求被 abort，用户只看到最新结果
   */
  function createSignal(): AbortSignal {
    controller?.abort()
    controller = new AbortController()
    return controller.signal
  }

  /**
   * 判断 signal 是否仍是最新请求
   * 用于 await 后检查：若期间又有新请求发起，本请求的响应已过期，丢弃不写回
   */
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

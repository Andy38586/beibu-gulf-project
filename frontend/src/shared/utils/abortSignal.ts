/**
 * 信号组合工具（AbortSignal.any 的兼容性替身）
 *
 * 背景：原实现用 `AbortSignal.any([内部超时, 外部取消])` 合并两个信号，但该 API 的
 * 可用下限是 Chrome 116 / Safari 17.4 / Firefox 124（2024 年），而 package.json 的
 * browserslist 声明 `Chrome >= 89`、`Safari >= 14.1`、`Firefox >= 114`；vite 的
 * `build.target: 'es2020'` 只降级**语法**、不 polyfill 运行时 API，因此低版本浏览器
 * 上会直接 TypeError，使「传了 signal 的请求」全部失败（浸没分析三个接口、港口/边界
 * 图层加载、航线与选址请求均走这条路径）。
 *
 * 本实现用 AbortController + abort 事件手写等价语义，不依赖任何新增 API。
 */
interface CombinedSignal {
  /** 组合后的信号（多源时为新 controller 的信号；单源/空源为透传或空信号） */
  signal: AbortSignal
  /**
   * 摘除挂在各外部源上的全部监听（1004-05）。
   * **必须**在请求 settle（正常完成或异常）后调用：只在 abort 路径摘除时，
   * 每次正常完成都会在长寿命外部 signal（如地图页 loadAbort）上残留一个闭包监听，
   * 监听数与闭包随请求数线性累积（04-A1「注册必有注销」破口）。
   * 幂等，可重复调用。
   */
  dispose: () => void
}

export function combineSignals(signals: Array<AbortSignal | undefined | null>): CombinedSignal {
  const list = signals.filter((s): s is AbortSignal => Boolean(s))

  if (list.length === 0) return { signal: new AbortController().signal, dispose: () => {} }
  // 单源直接透传（保持引用同一，便于上游继续 addEventListener/读取 aborted）
  if (list.length === 1) return { signal: list[0], dispose: () => {} }

  // 已有源处于中止态 → 组合信号立即同步到中止态（对齐 AbortSignal.any 语义）
  const alreadyAborted = list.find((s) => s.aborted)
  if (alreadyAborted) {
    const settled = new AbortController()
    settled.abort(alreadyAborted.reason)
    return { signal: settled.signal, dispose: () => {} }
  }

  const controller = new AbortController()
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    for (const s of list) s.removeEventListener('abort', onAbort)
  }
  const onAbort = (): void => {
    const src = list.find((s) => s.aborted)
    dispose()
    controller.abort(src?.reason)
  }
  for (const s of list) s.addEventListener('abort', onAbort)
  return { signal: controller.signal, dispose }
}

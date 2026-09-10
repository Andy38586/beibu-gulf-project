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
export function combineSignals(signals: Array<AbortSignal | undefined | null>): AbortSignal {
  const list = signals.filter((s): s is AbortSignal => Boolean(s))

  if (list.length === 0) return new AbortController().signal
  // 单源直接透传（保持引用同一，便于上游继续 addEventListener/读取 aborted）
  if (list.length === 1) return list[0]

  // 已有源处于中止态 → 组合信号立即同步到中止态（对齐 AbortSignal.any 语义）
  const alreadyAborted = list.find((s) => s.aborted)
  if (alreadyAborted) {
    const settled = new AbortController()
    settled.abort(alreadyAborted.reason)
    return settled.signal
  }

  const controller = new AbortController()
  const onAbort = (): void => {
    const src = list.find((s) => s.aborted)
    for (const s of list) s.removeEventListener('abort', onAbort)
    controller.abort(src?.reason)
  }
  for (const s of list) s.addEventListener('abort', onAbort)
  return controller.signal
}

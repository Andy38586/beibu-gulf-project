/**
 * 子进程结果 → 退出码映射（修复 P1-07，2026-09-15）。
 *
 * 背景：`spawnSync` 的返回值在**被信号杀死**时是 `{ status: null, signal: 'SIGKILL', error: undefined }`。
 * 原映射 `r.status ?? (r.error ? 1 : 0)` 对这种情况会得 `0`（= 成功），于是被 OOM / 超时杀掉的
 * `npm run build` 会被 pre-merge-check 记成 PASS 并输出 "READY TO MERGE"——门禁根本没跑完。
 *
 * 正确语义（失败优先）：
 *   status 是数字 → 用它；
 *   否则有 signal（被信号终止）→ 失败(1)；
 *   否则按 error 判定 → 有错 1，无错 0。
 */

/**
 * @param {{ status?: number|null, signal?: string|null, error?: unknown }} r
 * @returns {number} 进程退出码语义（0 = 成功）
 */
function toExitCode(r = {}) {
  const { status, signal, error } = r
  if (typeof status === 'number') return status
  if (signal) return 1
  return error ? 1 : 0
}

module.exports = { toExitCode }

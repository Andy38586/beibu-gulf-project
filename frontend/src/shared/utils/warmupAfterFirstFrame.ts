/**
 * warmupAfterFirstFrame —— 首帧后空闲预热调度（2026-10-02，Cesium 预取提前）。
 *
 * 取代 App.vue 原来的「load 事件 + 固定 3s」（`warmup(3000, preloadCesium)`）：
 * 那 3s 是拍的——与"首屏到底忙不忙"无关，而切 3D 时要等的 Cesium.js（5.8MB）一个字节
 * 都没提前（z037「点 3D 像点不进去」的体感来源）。
 *
 * 现口径：**等首帧画完 → requestIdleCallback（浏览器真空闲才跑）→ 执行 task**。
 * 仍然不抢首屏带宽：idle 回调本身就是"浏览器没事干"的信号；且 task 抛错一律静默
 * （预热只是优化，正式路径自会按需加载）。
 *
 * 🔴 为什么不再等 `load`：SPA 挂载时 load 常已触发（readyState=complete），原实现为绕开
 * "监听永不回调"专门写了一个分支；rAF 没有这个问题——它必定在挂载后的下一帧回调。
 */
type IdleWindow = Window & { requestIdleCallback?: (cb: () => void) => number }

/**
 * 首帧画完后在浏览器空闲时执行 task（失败静默）。
 * 幂等/去重由 task 自己负责（如 `preloadCesium` 是模块级幂等）。
 */
export function warmupAfterFirstFrame(task: () => void): void {
  const run = (): void => {
    try {
      task()
    } catch {
      // 预热失败静默——只是优化手段，不影响功能（正式路径自会按需加载）
    }
  }
  const afterFrame = (): void => {
    const idle = (window as IdleWindow).requestIdleCallback
    if (typeof idle === 'function') {
      idle(run)
      return
    }
    // 无 requestIdleCallback（老 Safari）：画完后再让一个宏任务，等价于"首帧后"
    setTimeout(run, 0)
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(afterFrame)
  else setTimeout(afterFrame, 0)
}

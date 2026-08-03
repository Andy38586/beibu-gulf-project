/**
 * PerfReporter —— 性能埋点（Phase 0，性能优化路线图 v2）
 * 设计约束（来自路线图红线）：
 * - 仅 `import.meta.env.DEV` 下生效，**不进生产包**。
 * - 零新增依赖（仅用浏览器原生 Performance API / PerformanceObserver）。
 * 采集指标：
 * - 首屏：FCP / LCP / TTI（近似，loadEventEnd）
 * - 渲染：longtask 次数（掉帧/长任务）
 * - 加载：Cesium 脚本 onload 耗时 + Viewer 首帧就绪耗时（★ 注意：Cesium 是全局脚本
 * `/cesium/Cesium.js`，非 `import('cesium')`，度量对象必须是脚本 onload）
 * - ECharts：`setOption` 单次耗时（由图表组件用 perfTimeFn 包裹）
 * - 图层：BusinessLayerManager 增/删/更 耗时（由管理器用 perfTimeFn 包裹）
 * 使用：浏览器控制台 `window.__perf.print()` 打印，`window.__perf.report()` 取 JSON。
 */

interface PerfEntry {
  name: string
  start: number
  duration: number
}

interface CesiumTimings {
  scriptOnloadMs?: number
  viewerReadyMs?: number
  totalMs?: number
}

interface PerfState {
  marks: Record<string, number>
  measures: Record<string, number>
  entries: PerfEntry[]
  longtasks: number
  fcp?: number
  lcp?: number
  tti?: number
  cesium?: CesiumTimings
}

const state: PerfState = {
  marks: {},
  measures: {},
  entries: [],
  longtasks: 0,
}

let started = false

/** 打点（时间点标记） */
export function perfMark(name: string): void {
  if (!import.meta.env.DEV) return
  state.marks[name] = performance.now()
}

/** 量取两标记间耗时，存入 measures */
export function perfMeasure(name: string, startMark: string, endMark: string): number | null {
  if (!import.meta.env.DEV) return null
  const s = state.marks[startMark]
  const e = state.marks[endMark]
  if (s == null || e == null) return null
  const d = e - s
  state.measures[name] = d
  state.entries.push({ name, start: s, duration: d })
  return d
}

/** 包裹同步函数，自动记录耗时（生产环境跳过计时、仍执行原函数，零开销） */
export function perfTimeFn<T>(name: string, fn: () => T): T {
  if (!import.meta.env.DEV) return fn()
  const s = performance.now()
  try {
    return fn()
  } finally {
    const d = performance.now() - s
    state.measures[name] = d
    state.entries.push({ name, start: s, duration: d })
  }
}

/** 记录 Cesium 专项耗时 */
export function recordCesium(p: CesiumTimings): void {
  state.cesium = { ...(state.cesium ?? {}), ...p }
}

/** 初始化观察者（FCP/LCP/longtask/TTI）并挂载 window.__perf */
export function initPerfReporter(): void {
  if (!import.meta.env.DEV) return
  if (started) return
  started = true

  // FCP
  try {
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint') state.fcp = entry.startTime
      }
    })
    po.observe({ type: 'paint', buffered: true })
  } catch {
    /* PerformanceObserver paint 不支持时忽略 */
  }

  // LCP
  try {
    const po = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const last = entries[entries.length - 1]
      state.lcp = last.startTime
    })
    po.observe({ type: 'largest-contentful-paint', buffered: true })
  } catch {
    /* LCP 不支持时忽略 */
  }

  // longtask（掉帧 / 长任务）
  try {
    const po = new PerformanceObserver((_list) => {
      state.longtasks += 1
    })
    po.observe({ type: 'longtask', buffered: true })
  } catch {
    /* longtask 不支持时忽略 */
  }

  // TTI 近似：load 事件结束时刻
  window.addEventListener('load', () => {
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined
    if (nav) state.tti = nav.loadEventEnd
  })

  const api = {
    state,
    mark: perfMark,
    measure: perfMeasure,
    time: perfTimeFn,
    recordCesium,
    report: (): PerfState => JSON.parse(JSON.stringify(state)),
    print: (): void => {
      // eslint-disable-next-line no-console
      console.table(state.entries)
      // eslint-disable-next-line no-console
      console.log(
        '[perf] FCP=%sms LCP=%sms TTI=%sms longtasks=%d cesium=%o',
        state.fcp != null ? state.fcp.toFixed(1) : 'n/a',
        state.lcp != null ? state.lcp.toFixed(1) : 'n/a',
        state.tti != null ? state.tti.toFixed(1) : 'n/a',
        state.longtasks,
        state.cesium ?? 'n/a'
      )
    },
  }
  ;(window as unknown as Record<string, unknown>).__perf = api
  // eslint-disable-next-line no-console
  console.log('[perf] PerfReporter 已挂载（dev-only），window.__perf.print() 查看基线')
}

export default { initPerfReporter, perfMark, perfMeasure, perfTimeFn, recordCesium }

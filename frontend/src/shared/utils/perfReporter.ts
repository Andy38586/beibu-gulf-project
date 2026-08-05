/**
 * PerfReporter —— 性能埋点（生产可用版，2026-08-05 上线前重构）
 * 设计约束（沿用路线图红线 + 上线评审）：
 * - 零新增依赖（仅用浏览器原生 Performance API / PerformanceObserver / rAF）。
 * - 生产默认开启（VITE_PERF_ENABLED !== 'false'）：纯数字聚合，不存逐条明细，
 *   防内存增长；dev 额外保留 entries 明细供 window.__perf.print() 逐条查看。
 * 采集指标（五层）：
 * A. 首屏：FCP / LCP / CLS / TTI（近似，loadEventEnd）
 * B. 帧率：rAF 采样平均 FPS / 最低 FPS / 长帧（>50ms，业界标准）计数
 * C. 接口：apiRequest 统一入口打点（URL + 耗时）→ count/avg/max + p50/p95（样本窗口 50）
 * D. 错误：vue/script/promise 分类计数（main.ts 三个钩子接入）
 * E. 业务耗时：图层增删更（BLM）、ECharts setOption（perfTimeFn 包裹）→ count/avg/max
 * 使用：浏览器控制台 `window.__perf.print()`（生产为摘要） / `window.__perf.report()`（JSON）。
 * 上报：当前本地聚合（无后端端点）；接入数据库/真实部署后加 /api/perf POST，结构已留。
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

/** 业务耗时聚合（图层/ECharts/自定义 perfTimeFn） */
interface PerfAggTimer {
  count: number
  total: number
  max: number
}

/** 接口耗时桶：samples 保留最近 50 个用于分位计算 */
interface PerfApiBucket {
  count: number
  total: number
  max: number
  samples: number[]
}

interface PerfState {
  marks: Record<string, number>
  measures: Record<string, number>
  /** dev 明细（生产不填充，防内存增长） */
  entries: PerfEntry[]
  timers: Map<string, PerfAggTimer>
  api: Map<string, PerfApiBucket>
  errors: Record<string, number>
  fps: { samples: number[]; sum: number; min: number; longFrames: number }
  cls: number
  longtasks: number
  fcp?: number
  lcp?: number
  tti?: number
  cesium?: CesiumTimings
}

/** 生产开关：默认开（纯聚合开销 <0.1%），VITE_PERF_ENABLED=false 显式关闭 */
const PERF_ENABLED = import.meta.env.VITE_PERF_ENABLED !== 'false'
const IS_DEV = import.meta.env.DEV

/** 埋点是否启用（供调试模式等 UI 判断展示） */
export function isPerfEnabled(): boolean {
  return PERF_ENABLED
}

/** 长帧阈值（业界标准）：单帧 >50ms 视为掉帧 */
const LONG_FRAME_MS = 50
/** 接口分位样本窗口 */
const API_SAMPLE_WINDOW = 50
/** FPS 滚动窗口帧数（~3s @60fps） */
const FPS_WINDOW = 180

const state: PerfState = {
  marks: {},
  measures: {},
  entries: [],
  timers: new Map(),
  api: new Map(),
  errors: {},
  fps: { samples: [], sum: 0, min: Infinity, longFrames: 0 },
  cls: 0,
  longtasks: 0,
}

let started = false

/** 打点（时间点标记） */
export function perfMark(name: string): void {
  if (!PERF_ENABLED) return
  state.marks[name] = performance.now()
}

/** 量取两标记间耗时，存入 measures */
export function perfMeasure(name: string, startMark: string, endMark: string): number | null {
  if (!PERF_ENABLED) return null
  const s = state.marks[startMark]
  const e = state.marks[endMark]
  if (s == null || e == null) return null
  const d = e - s
  state.measures[name] = d
  if (IS_DEV) state.entries.push({ name, start: s, duration: d })
  return d
}

/** 包裹同步函数，记录耗时（生产聚合 count/avg/max；dev 额外存明细） */
export function perfTimeFn<T>(name: string, fn: () => T): T {
  if (!PERF_ENABLED) return fn()
  const s = performance.now()
  try {
    return fn()
  } finally {
    const d = performance.now() - s
    const agg = state.timers.get(name) ?? { count: 0, total: 0, max: 0 }
    agg.count += 1
    agg.total += d
    if (d > agg.max) agg.max = d
    state.timers.set(name, agg)
    if (IS_DEV) state.entries.push({ name, start: s, duration: d })
  }
}

/** 接口耗时打点（apiRequest 统一入口调用；path 不含 query，避免分桶爆炸） */
export function perfRecordApi(path: string, durationMs: number): void {
  if (!PERF_ENABLED) return
  const bucket = state.api.get(path) ?? { count: 0, total: 0, max: 0, samples: [] }
  bucket.count += 1
  bucket.total += durationMs
  if (durationMs > bucket.max) bucket.max = durationMs
  bucket.samples.push(durationMs)
  if (bucket.samples.length > API_SAMPLE_WINDOW) bucket.samples.shift()
  state.api.set(path, bucket)
}

/** 错误分类计数（main.ts 三个钩子接入：vue / script / promise） */
export function perfReportError(type: 'vue' | 'script' | 'promise'): void {
  if (!PERF_ENABLED) return
  state.errors[type] = (state.errors[type] ?? 0) + 1
}

/** 记录 Cesium 专项耗时 */
export function recordCesium(p: CesiumTimings): void {
  state.cesium = { ...(state.cesium ?? {}), ...p }
}

/** 分位计算（samples 已按升序） */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[idx]
}

/** 序列化当前聚合态（Map → 普通对象），供 window.__perf.report 与测试使用 */
export function buildPerfReport(): Record<string, unknown> {
  const timers: Record<string, PerfAggTimer> = {}
  state.timers.forEach((v, k) => {
    timers[k] = v
  })
  const apiBuckets: Record<
    string,
    { count: number; avg: number; max: number; p50: number; p95: number }
  > = {}
  state.api.forEach((v, k) => {
    const sorted = [...v.samples].sort((a, b) => a - b)
    apiBuckets[k] = {
      count: v.count,
      avg: v.count > 0 ? v.total / v.count : 0,
      max: v.max,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
    }
  })
  return {
    fcp: state.fcp,
    lcp: state.lcp,
    cls: state.cls,
    tti: state.tti,
    longtasks: state.longtasks,
    fps: {
      avg: state.fps.samples.length > 0 ? state.fps.sum / state.fps.samples.length : 0,
      min: state.fps.min === Infinity ? 0 : state.fps.min,
      longFrames: state.fps.longFrames,
    },
    timers,
    api: apiBuckets,
    errors: { ...state.errors },
    cesium: state.cesium ?? null,
    measures: { ...state.measures },
  }
}

/** 测试专用：重置聚合态（避免用例间累积污染断言） */
export function _resetPerfForTest(): void {
  state.marks = {}
  state.measures = {}
  state.entries = []
  state.timers = new Map()
  state.api = new Map()
  state.errors = {}
  state.fps = { samples: [], sum: 0, min: Infinity, longFrames: 0 }
  state.cls = 0
  state.longtasks = 0
  state.fcp = undefined
  state.lcp = undefined
  state.tti = undefined
  state.cesium = undefined
}

/** 生产摘要：一行可读基线 */
function printSummary(): void {
  const f = state.fps
  const avgFps = f.samples.length > 0 ? (f.sum / f.samples.length).toFixed(1) : 'n/a'
  const minFps = f.min === Infinity ? 'n/a' : f.min.toFixed(1)
  const parts = [`FPS avg=${avgFps} min=${minFps} longFrames=${f.longFrames}`]
  if (state.api.size > 0) {
    const slow = [...state.api.entries()]
      .sort((a, b) => b[1].max - a[1].max)
      .slice(0, 3)
      .map(([path, b]) => {
        const sorted = [...b.samples].sort((x, y) => x - y)
        return `${path} p50=${percentile(sorted, 0.5).toFixed(0)}ms p95=${percentile(sorted, 0.95).toFixed(0)}ms (${b.count})`
      })
      .join(' | ')
    parts.push(`API ${slow}`)
  }
  if (state.timers.size > 0) {
    const t = [...state.timers.entries()]
      .map(([name, a]) => `${name} avg=${(a.total / a.count).toFixed(1)}ms max=${a.max.toFixed(0)}ms`)
      .join(' | ')
    parts.push(`TIMERS ${t}`)
  }
  const errTotal = Object.values(state.errors).reduce((s, n) => s + n, 0)
  parts.push(
    `errors=${errTotal}${errTotal > 0 ? ` ${JSON.stringify(state.errors)}` : ''}`
  )
  parts.push(
    `FCP=${state.fcp?.toFixed(1) ?? 'n/a'} LCP=${state.lcp?.toFixed(1) ?? 'n/a'} CLS=${state.cls.toFixed(3)} TTI=${state.tti?.toFixed(1) ?? 'n/a'} longtasks=${state.longtasks}`
  )
  // eslint-disable-next-line no-console
  console.log(`[perf] ${parts.join(' | ')}`)
}

/** 初始化观察者（FCP/LCP/CLS/longtask/TTI）与 FPS 采样，挂载 window.__perf */
export function initPerfReporter(): void {
  if (!PERF_ENABLED) return
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

  // CLS（布局稳定，Web Vitals 三件套）
  try {
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        state.cls += (entry as { value?: number }).value ?? 0
      }
    })
    po.observe({ type: 'layout-shift', buffered: true })
  } catch {
    /* layout-shift 不支持时忽略 */
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

  // FPS 采样：rAF 间隔 → 平均/最低/长帧（后台 tab rAF 暂停，天然只在活跃时采样）
  let last = performance.now()
  const sample = (now: number): void => {
    const dt = now - last
    last = now
    // 过滤 tab 切换/长暂停（>1s 不计入，避免污染均值）
    if (dt > 0 && dt < 1000) {
      const fps = 1000 / dt
      const f = state.fps
      f.samples.push(fps)
      f.sum += fps
      if (f.samples.length > FPS_WINDOW) {
        const removed = f.samples.shift() ?? 0
        f.sum -= removed
      }
      if (fps < f.min) f.min = fps
      if (dt > LONG_FRAME_MS) f.longFrames += 1
    }
    requestAnimationFrame(sample)
  }
  requestAnimationFrame(sample)

  const api = {
    state,
    mark: perfMark,
    measure: perfMeasure,
    time: perfTimeFn,
    recordCesium,
    recordApi: perfRecordApi,
    reportError: perfReportError,
    report: buildPerfReport,
    print: (): void => {
      if (IS_DEV) {
        // eslint-disable-next-line no-console
        console.table(state.entries)
      }
      printSummary()
    },
  }
  ;(window as unknown as Record<string, unknown>).__perf = api
  // eslint-disable-next-line no-console
  console.log(`[perf] PerfReporter 已挂载${IS_DEV ? '（dev）' : '（production）'}，window.__perf.print() 查看基线`)
}

export default {
  initPerfReporter,
  perfMark,
  perfMeasure,
  perfTimeFn,
  perfRecordApi,
  perfReportError,
  recordCesium,
  buildPerfReport,
}

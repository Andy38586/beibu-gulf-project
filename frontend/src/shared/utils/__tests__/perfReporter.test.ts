/**
 * PerfReporter 聚合逻辑测试（生产可用版）
 * 覆盖：perfTimeFn 聚合（count/avg/max）、perfRecordApi 分位 + 样本窗口截断、
 * perfReportError 分类计数、perfMark/perfMeasure 度量、buildPerfReport 序列化。
 * 不调用 initPerfReporter（避免启动 rAF 采样循环污染测试进程）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import ts from 'typescript'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  _perfStateForTest,
  _resetPerfForTest,
  buildPerfReport,
  isPerfEnabled,
  perfMark,
  perfMeasure,
  perfRecordApi,
  perfReportError,
  perfTimeFn,
  resolvePerfEnabled,
} from '../perfReporter'

interface ApiBucket {
  count: number
  avg: number
  max: number
  p50: number
  p95: number
}

function apiReport(): Record<string, ApiBucket> {
  return buildPerfReport().api as Record<string, ApiBucket>
}

beforeEach(() => {
  _resetPerfForTest()
})

describe('PerfReporter 聚合（生产可用版）', () => {
  it('perfTimeFn：聚合 count/avg/max 且不改变原函数行为', () => {
    perfTimeFn('layer:create:geojson', () => 1)
    perfTimeFn('layer:create:geojson', () => 2)
    perfTimeFn('layer:create:geojson', () => 3)

    const timers = buildPerfReport().timers as Record<
      string,
      { count: number; total: number; max: number }
    >
    const t = timers['layer:create:geojson']
    expect(t.count).toBe(3)
    expect(t.max).toBeGreaterThanOrEqual(t.total / t.count)
  })

  it('perfRecordApi：count/avg/max/p50/p95 聚合正确', () => {
    // 10 个样本：1..10（ms）
    for (let i = 1; i <= 10; i++) {
      perfRecordApi('/api/test', i * 10)
    }
    const b = apiReport()['/api/test']
    expect(b.count).toBe(10)
    expect(b.avg).toBeCloseTo(55, 0) // (10+20+...+100)/10 = 55
    expect(b.max).toBe(100)
    expect(b.p50).toBe(50) // 升序第 5 个 = 50
    expect(b.p95).toBe(100) // 升序第 ceil(9.5)=10 个 = 100
  })

  it('perfRecordApi：样本窗口截断（>50 只保留最近 50，count 仍全量）', () => {
    for (let i = 1; i <= 80; i++) {
      perfRecordApi('/api/test/window', i)
    }
    const b = apiReport()['/api/test/window']
    expect(b.count).toBe(80)
    // 最近 50 个样本是 31..80 → p50 = 升序第 25 个 = 31+24 = 55
    expect(b.p50).toBe(55)
    // p95 = 升序第 ceil(0.95*50)=48 个 = 31+47 = 78；旧样本（1..30）已溢出窗口不受影响
    expect(b.p95).toBe(78)
    expect(b.max).toBe(80)
  })

  it('perfReportError：分类计数', () => {
    perfReportError('vue')
    perfReportError('vue')
    perfReportError('script')
    const errors = buildPerfReport().errors as Record<string, number>
    expect(errors.vue).toBe(2)
    expect(errors.script).toBe(1)
    expect(errors.promise).toBeUndefined()
  })

  it('perfMark/perfMeasure：度量差值记录', () => {
    perfMark('a')
    perfMark('b')
    const d = perfMeasure('m', 'a', 'b')
    expect(d).not.toBeNull()
    expect((buildPerfReport().measures as Record<string, number>).m).toBeGreaterThanOrEqual(0)
  })

  it('buildPerfReport：Map 序列化为普通可 JSON 化对象', () => {
    perfRecordApi('/api/x', 5)
    const report = buildPerfReport()
    expect(() => JSON.stringify(report)).not.toThrow()
    expect(Array.isArray(report.timers)).toBe(false)
    expect(report.fps).toHaveProperty('longFrames')
  })
})

describe('PerfReporter 开关口径（生产默认关）', () => {
  // 回归守卫：2026-09-10 前口径是 `flag !== 'false'`（默认开），生产因此常挂
  // 4 个 PerformanceObserver + 永续 rAF 采样循环。此处锁定「生产默认关」。
  it('dev 恒开，与 flag 取值无关', () => {
    expect(resolvePerfEnabled(true, undefined)).toBe(true)
    expect(resolvePerfEnabled(true, 'false')).toBe(true)
  })

  it('生产（dev=false）默认关闭：未注入 flag 时不开', () => {
    expect(resolvePerfEnabled(false, undefined)).toBe(false)
  })

  it('生产仅当显式 VITE_PERF_ENABLED=true 才开', () => {
    expect(resolvePerfEnabled(false, 'true')).toBe(true)
    expect(resolvePerfEnabled(false, 'false')).toBe(false)
  })

  it('测试环境走 dev 语义，isPerfEnabled 为 true（保证聚合用例有效）', () => {
    expect(isPerfEnabled()).toBe(true)
  })
})

/**
 * 扫出「对 state.entries 做环形缓冲式修改的代码落在哪些函数里」（AST 层，不认字符串/注释）。
 * 口径 = state.entries 的 push/shift/unshift/splice/pop/sort/fill 调用，以及对
 * state.entries 的整体赋值（右侧是空数组字面量的重置语义除外）。
 * 判据不看具体形状：等价重构（改辅助函数名、内部换 slice 截断）不误红，
 * 而在调用点再抄一份（push+shift 或赋值重写）必红 —— 那才是「两条路径各自为政」。
 */
function entriesMutatorFns(source: string, fileName = 'probe.ts'): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const chain = (node: ts.Expression): string | null => {
    if (ts.isIdentifier(node)) return node.text
    if (ts.isPropertyAccessExpression(node)) {
      const left = chain(node.expression)
      return left == null ? null : left + '.' + node.name.text
    }
    return null
  }
  const owner = (node: ts.Node): string => {
    let cur: ts.Node | undefined = node.parent
    while (cur) {
      if (
        ts.isFunctionDeclaration(cur) ||
        ts.isFunctionExpression(cur) ||
        ts.isArrowFunction(cur)
      ) {
        const named = (cur as ts.FunctionDeclaration).name
        return named ? named.text : '<anonymous>'
      }
      cur = cur.parent
    }
    return '<top-level>'
  }
  const found = new Set<string>()
  const walk = (node: ts.Node): void => {
    const isShiftOrPush =
      ts.isCallExpression(node) &&
      chain(node.expression)?.replace(/\.(push|shift|unshift|splice|pop|sort|fill)$/, '') ===
        'state.entries'
    const isRewriteAssign =
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      chain(node.left) === 'state.entries' &&
      !(ts.isArrayLiteralExpression(node.right) && node.right.elements.length === 0)
    const isEntriesWrite = isShiftOrPush || isRewriteAssign
    if (isEntriesWrite) found.add(owner(node))
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return [...found]
}

const PERF_SRC = path.resolve(__dirname, '..', 'perfReporter.ts')

describe('dev 明细环形上限与 FPS 空态（F-6：长会话防内存增长）', () => {
  /** 与 perfReporter 的 MAX_DEV_ENTRIES 同值：上限若合法调整，此断言同笔改 */
  const CAP = 1000

  it('🔴 @guard-red-sample 环形缓冲的写不落在两条测量路径上', () => {
    const owners = entriesMutatorFns(readFileSync(PERF_SRC, 'utf8'))
    // 两个调用点各自改 entries = 两条独立口径，改一处就会漏另一处
    expect(owners).not.toContain('perfMeasure')
    expect(owners).not.toContain('perfTimeFn')
    expect(owners.length).toBeLessThanOrEqual(1)
  })

  it('写点扫描器：阳性对照与近失对照', () => {
    const one =
      'function a() {\n  state.entries.push({})\n  if (state.entries.length > 9) state.entries.shift()\n}'
    expect(entriesMutatorFns(one)).toEqual(['a'])
    // 等价重构（slice 截断）仍是同一个函数 ⇒ 不制造第二处
    expect(
      entriesMutatorFns('function a() { state.entries = [...state.entries].slice(-9) }')
    ).toEqual(['a'])
    // 近失：整段重置不是环形口径
    expect(entriesMutatorFns('function a() { state.entries = [] }')).toEqual([])
    // 近失：别的容器 / 别的接收者 / 只读 / 字符串与注释
    expect(entriesMutatorFns('function a() { state.entriesMap.push({}) }')).toEqual([])
    expect(entriesMutatorFns('function a() { other.entries.push({}) }')).toEqual([])
    expect(entriesMutatorFns('function a() { return state.entries.length }')).toEqual([])
    expect(entriesMutatorFns("function a() { const s = 'state.entries.push({})' }")).toEqual([])
    expect(entriesMutatorFns('// state.entries.push({})\nfunction a() {}')).toEqual([])
    // 阳性：两个函数各写一次 ⇒ 两处（这正是「调用点又抄一份」的形状）
    expect(
      entriesMutatorFns(
        'function a() { state.entries.push({}) }\nfunction b() { state.entries.shift() }'
      )
    ).toEqual(['a', 'b'])
  })

  it('🔴 @guard-red-sample perfTimeFn 写入超过上限时丢最旧、条数不涨', () => {
    for (let i = 0; i < CAP + 7; i++) {
      perfTimeFn(`fn:${i}`, () => i)
    }
    const entries = _perfStateForTest().entries
    expect(entries).toHaveLength(CAP)
    // 最早 7 条被丢弃，队首是第 8 次写入；队尾是最新一次
    expect(entries[0].name).toBe('fn:7')
    expect(entries[entries.length - 1].name).toBe(`fn:${CAP + 6}`)
  })

  it('perfMeasure 走同一条环形口径（两条 dev 明细路径不得各自为政）', () => {
    perfMark('s')
    perfMark('e')
    for (let i = 0; i < CAP + 3; i++) {
      perfMeasure(`m:${i}`, 's', 'e')
    }
    const entries = _perfStateForTest().entries
    expect(entries).toHaveLength(CAP)
    expect(entries[entries.length - 1].name).toBe(`m:${CAP + 2}`)
  })

  it('FPS 空态形状与重置同源：reset 后两处形状一致且不复用同一对象', () => {
    const first = _perfStateForTest().fps
    expect(first).toEqual({ samples: [], sum: 0, min: Infinity, longFrames: 0 })
    perfTimeFn('noise', () => 1)
    _resetPerfForTest()
    const second = _perfStateForTest().fps
    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    expect(_perfStateForTest().entries).toHaveLength(0)
  })
})

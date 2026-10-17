import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

// echarts 全量 mock：本件只验「增量更新口径」的单一入口与接线，不渲染。
vi.mock('echarts/charts', () => ({ BarChart: {}, LineChart: {} }))
vi.mock('echarts/components', () => ({
  GridComponent: {},
  LegendComponent: {},
  TitleComponent: {},
  TooltipComponent: {},
}))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))
const { initMock } = vi.hoisted(() => ({ initMock: vi.fn() }))
vi.mock('echarts/core', () => ({ init: initMock, use: vi.fn() }))

import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import { applyChartOption, useECharts } from '../useECharts'

/** 权威口径：两处调用点（useECharts.updateChart / WaterLevelProfilePanel）必须逐字相同 */
const MERGE_OPTS = { notMerge: false, replaceMerge: ['series'], lazyUpdate: true }

function makeInstance() {
  return { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), on: vi.fn(), off: vi.fn() }
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..', '..', '..')
const AUTHORITY = 'visualization/composables/useECharts.ts'
/** 自建 ECharts 实例的消费方：必须经同一入口，不得自抄 setOption 选项 */
const CONSUMERS = ['business/flood-analysis/components/WaterLevelProfilePanel.vue']
const SKIP_DIR = /^(__tests__|__mocks__|node_modules|\.local|dist)$/

/** 只取 .vue 的 script 块（模板区无 setOption），其余字符换等量换行以保行号 */
const SCRIPT_RE = /<script\b[^>]*>([\s\S]*?)<\/script>/g
function scriptOnly(text: string): string {
  if (!text.includes('<script')) return text
  let out = text.replace(/[^\n]/g, ' ')
  for (const m of text.matchAll(SCRIPT_RE)) {
    const body = m[1]
    const at = (m.index ?? 0) + m[0].indexOf(body)
    out = out.slice(0, at) + body + out.slice(at + body.length)
  }
  return out
}

function listSources(): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIR.test(e.name)) walk(path.join(dir, e.name))
        continue
      }
      if (!/\.(ts|vue)$/.test(e.name) || /\.(test|spec)\.(ts|vue)$/.test(e.name)) continue
      const full = path.join(dir, e.name)
      out.push({
        rel: path.relative(SRC, full).split(path.sep).join('/'),
        text: scriptOnly(fs.readFileSync(full, 'utf8')),
      })
    }
  }
  walk(SRC)
  return out
}

/** 违规形态一：手抄 setOption 的第二实参（选项字面量） */
function handWrittenSetOptionCalls(text: string): number[] {
  const sf = ts.createSourceFile('probe.ts', text, ts.ScriptTarget.Latest, true)
  const lines: number[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const isSetOption =
        ts.isPropertyAccessExpression(callee) && callee.name.getText(sf) === 'setOption'
      const second = node.arguments[1]
      if (isSetOption && second && ts.isObjectLiteralExpression(second)) {
        lines.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return lines
}

/**
 * 违规形态二：手抄合并选项对象（同义改写：先赋常量再传，或只抄一半）。
 * 只要求 notMerge + replaceMerge 同时出现——lazyUpdate 漏抄同样会让 series 残留或轴样式被重置。
 */
function inlineMergeOptsObjects(text: string): number[] {
  const sf = ts.createSourceFile('probe.ts', text, ts.ScriptTarget.Latest, true)
  const lines: number[] = []
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const names = node.properties
        .filter(ts.isPropertyAssignment)
        .map((p) => (ts.isIdentifier(p.name) ? p.name.text : p.name.getText(sf)))
      if (names.includes('notMerge') && names.includes('replaceMerge')) {
        lines.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return lines
}

function applyChartOptionCalls(text: string): number[] {
  const sf = ts.createSourceFile('probe.ts', text, ts.ScriptTarget.Latest, true)
  const lines: number[] = []
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'applyChartOption'
    ) {
      lines.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return lines
}

const HAND_WRITTEN_SAMPLE = `const o = getOption()
const inst = chartInstance
perfTimeFn('x', () => {
  inst.setOption(o, { notMerge: false, replaceMerge: ['series'], lazyUpdate: true })
})
const MERGE = { notMerge: false, replaceMerge: ['series'], lazyUpdate: true }
other.setOption(o, MERGE)
`

const NEAR_MISS_SAMPLE = `inst.setOption(o)
inst.setOptionX(o, { notMerge: false })
inst.applyChartOption(o, MERGE)
// inst.setOption(o, { notMerge: false, replaceMerge: ['series'], lazyUpdate: true })
const s = 'setOption(o, { notMerge: false })'
const partial = { notMerge: false }
`

describe('图表增量更新口径（U6）', () => {
  it('🔴 @guard-red-sample applyChartOption 传参即权威口径（notMerge=false + replaceMerge series + lazyUpdate）', () => {
    const inst = makeInstance()
    const option = { series: [{ id: 'a' }] }
    applyChartOption(inst as never, option)
    expect(inst.setOption).toHaveBeenCalledTimes(1)
    expect(inst.setOption).toHaveBeenCalledWith(option, MERGE_OPTS)
  })

  it('🔴 @guard-red-sample useECharts.updateChart 接线到同一入口（删调用即红）', async () => {
    const inst = makeInstance()
    initMock.mockImplementation(() => inst)
    const marker = { series: [{ id: 'marker' }] }
    let api: ReturnType<typeof useECharts> | null = null
    const Harness = defineComponent({
      setup() {
        api = useECharts({
          getOption: () => marker,
          chartRef: ref<HTMLElement | null>(document.createElement('div')),
        })
        return () => h('div')
      },
    })
    mount(Harness)
    api!.updateChart()
    expect(inst.setOption).toHaveBeenCalledWith(marker, MERGE_OPTS)
  })

  it('🔴 @guard-red-sample 全仓 setOption 选项字面量与合并选项字面量只许出现在权威源', () => {
    const sources = listSources()
    expect(sources.length).toBeGreaterThan(100)
    const offenders: Array<{ rel: string; line: number; kind: string }> = []
    for (const f of sources) {
      const allowed = f.rel === AUTHORITY
      if (allowed) continue
      for (const line of handWrittenSetOptionCalls(f.text))
        offenders.push({ rel: f.rel, line, kind: 'setOption' })
      for (const line of inlineMergeOptsObjects(f.text))
        offenders.push({ rel: f.rel, line, kind: 'mergeOpts' })
    }
    expect(offenders).toEqual([])
    // 权威源必须仍有 applyChartOption 定义（1 处调用），防「整段删掉即绿」；其内部字面量形态由上面两条行为断言锁定，不在此处钉死写法
    const authority = sources.find((f) => f.rel === AUTHORITY)
    expect(authority).toBeDefined()
    expect(applyChartOptionCalls(authority!.text)).toHaveLength(1)
    // 消费方必须真经入口（删调用点即红：光靠「无违规」抓不住「整段删掉」）
    for (const rel of CONSUMERS) {
      const consumer = sources.find((f) => f.rel === rel)
      expect(consumer, rel + ' 必须存在').toBeDefined()
      expect(
        applyChartOptionCalls(consumer!.text),
        rel + ' 必须调用 applyChartOption'
      ).toHaveLength(1)
    }
  })

  it('扫描器阳性对照：手抄两份 setOption + 一份合并选项字面量必须被数出', () => {
    expect(handWrittenSetOptionCalls(HAND_WRITTEN_SAMPLE)).toEqual([4])
    expect(inlineMergeOptsObjects(HAND_WRITTEN_SAMPLE)).toEqual([4, 6])
    expect(applyChartOptionCalls(HAND_WRITTEN_SAMPLE)).toEqual([])
  })

  it('扫描器近失对照：单参调用/改名/注释/字符串一律不误红', () => {
    expect(handWrittenSetOptionCalls(NEAR_MISS_SAMPLE)).toEqual([])
    expect(inlineMergeOptsObjects(NEAR_MISS_SAMPLE)).toEqual([])
    expect(applyChartOptionCalls(NEAR_MISS_SAMPLE)).toEqual([])
  })
})

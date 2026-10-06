// @vitest-environment jsdom
/**
 * 桑基图可见性回归（2026-10-02 用户实测"分流分析看不到"）：
 * ① tooltip 未 confine ⇒ html tooltip 逃出容器，被 4×4 面板（overflow:hidden）裁掉；
 * ② 末列节点标签默认画在节点右侧，而末列贴着画布右边界 ⇒ 中文标签越界被裁。
 * 阳性对照：把 confine 去掉 / 把最深列回退为默认位置，本文件对应用例必红。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

interface SankeyOptionLike {
  title: { text: string }
  tooltip: { trigger: string; confine?: boolean }
  series: Array<{
    type: string
    links: unknown[]
    data: Array<{ name: string; label?: { position: string } }>
  }>
}

const captured: {
  option: SankeyOptionLike | null
  setOptionArgs: { notMerge?: boolean; replaceMerge?: string[]; lazyUpdate?: boolean } | null
} = { option: null, setOptionArgs: null }

vi.mock('echarts/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('echarts/core')>()
  return {
    ...mod,
    init: vi.fn(() => ({
      setOption: vi.fn(
        (
          o: SankeyOptionLike,
          opts?: { notMerge?: boolean; replaceMerge?: string[]; lazyUpdate?: boolean }
        ) => {
          captured.option = o
          captured.setOptionArgs = opts ?? null
        }
      ),
      on: vi.fn(),
      off: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
    })),
    use: vi.fn(),
  }
})
vi.mock('echarts/charts', () => ({ SankeyChart: {} }))
vi.mock('echarts/components', () => ({
  LegendComponent: {},
  TitleComponent: {},
  TooltipComponent: {},
}))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

import SankeyChart from '../SankeyChart.vue'

/** 三段口径：西江上行货 → 平陆运河 → 三港（末列 = 两个港节点） */
const NODES = [{ name: '西江上行货' }, { name: '平陆运河' }, { name: '钦州港' }, { name: '防城港' }]
const LINKS = [
  { source: '西江上行货', target: '平陆运河', value: 900 },
  { source: '平陆运河', target: '钦州港', value: 700 },
  { source: '平陆运河', target: '防城港', value: 200 },
]

function chartOption(): SankeyOptionLike {
  mount(SankeyChart, { props: { title: '西江货类转移流向', nodes: NODES, links: LINKS } })
  if (!captured.option) throw new Error('未捕获到 option（组件未在挂载时 setOption？）')
  return captured.option
}

describe('SankeyChart 可见性回归', () => {
  it('tooltip 必须 confine（否则被面板 overflow:hidden 裁掉）', () => {
    const o = chartOption()
    expect(o.tooltip.trigger).toBe('item')
    expect(o.tooltip.confine).toBe(true)
  })

  it('末列节点标签翻到节点左侧（默认右侧会越画布右边界）', () => {
    const o = chartOption()
    const byName = Object.fromEntries(o.series[0].data.map((d) => [d.name, d]))
    expect(byName['钦州港'].label).toEqual({ position: 'left' })
    expect(byName['防城港'].label).toEqual({ position: 'left' })
    // 非末列不得被改写（标签位置交给系列级默认）
    expect(byName['西江上行货'].label).toBeUndefined()
    expect(byName['平陆运河'].label).toBeUndefined()
  })

  it('结构不变量：类型/链接/标题不被可见性修复改动', () => {
    const o = chartOption()
    expect(o.series[0].type).toBe('sankey')
    expect(o.series[0].links).toEqual(LINKS)
    expect(o.title.text).toBe('西江货类转移流向')
  })

  it('z038④：setOption 走全量 merge（notMerge:false + replaceMerge series），不再整体重建', () => {
    chartOption()
    expect(captured.setOptionArgs).toEqual({
      notMerge: false,
      replaceMerge: ['series'],
      lazyUpdate: true,
    })
  })
})

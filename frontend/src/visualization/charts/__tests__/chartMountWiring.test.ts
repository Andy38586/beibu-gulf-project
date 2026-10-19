// @vitest-environment jsdom
/**
 * 图表容器挂载回归（必要性审判波二·单元 K）
 *
 * 治的失效：`ref="chartRef"` 绑的是 setup 作用域内的变量。若组件把 useECharts 内部
 * 自建的 ref（未绑定模板）当容器，`echarts.init` 永远拿不到元素 ⇒ 图空白且无报错。
 * 本文件断言三张图挂载后都真的用 DOM 容器初始化了实例。
 *
 * 阳性对照：把 BarChart / LineChart / SankeyChart 里的 `const chartRef = ref(null)`
 * 删掉、改回从语 composable 里解构（即不传外部 ref），本文件必红。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const initCalls: Array<unknown> = []

vi.mock('echarts/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('echarts/core')>()
  return {
    ...mod,
    init: vi.fn((el: unknown) => {
      initCalls.push(el)
      return {
        setOption: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        resize: vi.fn(),
        dispose: vi.fn(),
      }
    }),
    use: vi.fn(),
  }
})
vi.mock('echarts/charts', () => ({ BarChart: {}, LineChart: {}, SankeyChart: {} }))
vi.mock('echarts/components', () => ({
  GridComponent: {},
  LegendComponent: {},
  TitleComponent: {},
  TooltipComponent: {},
}))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

import BarChart from '../BarChart.vue'
import LineChart from '../LineChart.vue'
import SankeyChart from '../SankeyChart.vue'

describe('图表容器挂载（单元 K：删 defineExpose 后仍必须真的初始化实例）', () => {
  it('🔴 @guard-red-sample 三图挂载后各自用模板容器初始化 echarts 实例', () => {
    initCalls.length = 0

    const bar = mount(BarChart, { props: { series: [{ name: 'a', data: [1] }] } })
    const line = mount(LineChart, { props: { series: [{ name: 'a', data: [1] }] } })
    const sankey = mount(SankeyChart, {
      props: {
        nodes: [{ name: 'A' }, { name: 'B' }],
        links: [{ source: 'A', target: 'B', value: 1 }],
      },
    })

    const tags = initCalls.map((el) => (el as HTMLElement | null)?.className ?? null)
    expect(tags).toContain('bar-chart')
    expect(tags).toContain('line-chart')
    expect(tags).toContain('sankey-chart')

    bar.unmount()
    line.unmount()
    sankey.unmount()
  })
})

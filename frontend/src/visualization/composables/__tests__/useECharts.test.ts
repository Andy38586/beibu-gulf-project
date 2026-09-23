import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'

// echarts 全量 mock：本件只测生命周期接线（init 次数 / unmount dispose / chartRef 补初始化），
// 不测渲染。三条断言各对应 useECharts 里一处此前零覆盖的接线。
const { initMock } = vi.hoisted(() => ({ initMock: vi.fn() }))

vi.mock('echarts/charts', () => ({ BarChart: {}, LineChart: {} }))
vi.mock('echarts/components', () => ({
  GridComponent: {},
  LegendComponent: {},
  TitleComponent: {},
  TooltipComponent: {},
}))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))
vi.mock('echarts/core', () => ({ init: initMock, use: vi.fn() }))

import { useECharts } from '../useECharts'

function makeInstance() {
  return {
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  }
}

/** 真组件上下文挂载（onMounted/onUnmounted 只在 setup 内有效，独立调用会被 Vue 丢弃） */
function mountHarness(initial: HTMLElement | null = null) {
  const chartRef = ref<HTMLElement | null>(initial)
  const Harness = defineComponent({
    setup() {
      useECharts({ getOption: () => ({}), chartRef })
      return () => h('div')
    },
  })
  const wrapper = mount(Harness)
  return { wrapper, chartRef }
}

describe('useECharts 生命周期接线（W8）', () => {
  // 调用计数是跨用例共享的全局 mock，必须逐例清空（否则上例的 init 会算进下例）
  beforeEach(() => {
    initMock.mockReset()
    initMock.mockImplementation(() => makeInstance())
  })

  it('🔴 同一容器只 init 一次：幂等守卫拦住二次初始化（删守卫即红）', async () => {
    const el = document.createElement('div')
    initMock.mockImplementation(() => makeInstance())
    const { chartRef } = mountHarness(el)
    expect(initMock).toHaveBeenCalledTimes(1) // onMounted

    // v-if 重新挂载形态：chartRef 由空变非空会再次触发 watch → initChart
    chartRef.value = null
    await Promise.resolve()
    chartRef.value = el
    await Promise.resolve()

    expect(initMock).toHaveBeenCalledTimes(1)
  })

  it('🔴 卸载即 dispose（删 onUnmounted(disposeChart) 即红）', () => {
    const el = document.createElement('div')
    const inst = makeInstance()
    initMock.mockImplementation(() => inst)
    const { wrapper } = mountHarness(el)
    expect(initMock).toHaveBeenCalledTimes(1)

    wrapper.unmount()
    expect(inst.dispose).toHaveBeenCalledTimes(1)
  })

  it('🔴 chartRef 由空变非空时补初始化（删 watch(chartRef) 即红）', async () => {
    const el = document.createElement('div')
    initMock.mockImplementation(() => makeInstance())
    const { chartRef } = mountHarness(null)
    // onMounted 时容器还不存在（v-if 下 chartRef 为 null）⇒ 不初始化
    expect(initMock).not.toHaveBeenCalled()

    chartRef.value = el
    await Promise.resolve()
    expect(initMock).toHaveBeenCalledTimes(1)
  })
})

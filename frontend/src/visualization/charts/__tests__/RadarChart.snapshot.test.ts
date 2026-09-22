// @vitest-environment jsdom
/**
 * 雷达图"示例数据"角标：快照兜底数据源必须明示。
 * 阳性对照：snapshot=true 而模板不渲染角标 ⇒ 第一条红；
 * snapshot=false 渲染角标 ⇒ 第二条红。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('echarts/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('echarts/core')>()
  return {
    ...mod,
    init: vi.fn(() => ({
      setOption: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
    })),
    use: vi.fn(),
  }
})
vi.mock('echarts/charts', () => ({ RadarChart: {}, LineChart: {}, BarChart: {} }))
vi.mock('echarts/components', () => ({
  GridComponent: {},
  LegendComponent: {},
  TitleComponent: {},
  TooltipComponent: {},
}))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

import RadarChart from '../RadarChart.vue'

const xiaoqu = {
  id: 'snap',
  name: '腾龙阁小区',
  lng: 108.6,
  lat: 21.9,
  score: 85.2,
  breakdown: { hospital: 80 },
}

describe('RadarChart 示例数据角标', () => {
  it('snapshot=true 时渲染"示例数据"角标', () => {
    const wrapper = mount(RadarChart, {
      props: { xiaoqu, selectedTypes: ['hospital'], snapshot: true },
    })
    expect(wrapper.find('.radar-snapshot-badge').exists()).toBe(true)
    expect(wrapper.find('.radar-snapshot-badge').text()).toContain('示例数据')
  })

  it('snapshot=false（真实分析结果）不渲染角标', () => {
    const wrapper = mount(RadarChart, {
      props: { xiaoqu, selectedTypes: ['hospital'], snapshot: false },
    })
    expect(wrapper.find('.radar-snapshot-badge').exists()).toBe(false)
  })

  it('无数据（EmptyState）时不渲染角标', () => {
    const wrapper = mount(RadarChart, {
      props: { xiaoqu: null, selectedTypes: [], snapshot: true },
    })
    expect(wrapper.find('.radar-snapshot-badge').exists()).toBe(false)
  })
})

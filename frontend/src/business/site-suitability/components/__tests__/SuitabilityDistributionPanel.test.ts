// @vitest-environment jsdom
/**
 * SuitabilityDistributionPanel 契约测试：
 * ①无数据且非 loading → 「暂无数据」；②10 档分桶 + 统计行数值；③loading 空档不显示空态。
 * 只 mock 图表模块（@/visualization），面板内部的数据变换走真实实现。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/visualization', () => ({
  BarChart: {
    name: 'BarChart',
    props: ['title', 'xData', 'series'],
    template: '<div class="bar-chart-stub" />',
  },
  ChartLoading: {
    name: 'ChartLoading',
    template: '<div class="chart-loading-stub" />',
  },
}))

import type { SiteSuitabilityResponseParsed } from '@/types/schemas'

import SuitabilityDistributionPanel from '../SuitabilityDistributionPanel.vue'

function makeResponse(scores: number[]): SiteSuitabilityResponseParsed {
  return {
    type: 'FeatureCollection',
    features: scores.map((score, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [108.5 + i * 0.01, 21.5 + i * 0.01] },
      properties: { id: i + 1, score },
    })),
    metadata: {
      count: scores.length,
      weights: { inundation: 0.4, terrain: 0.1, land: 0.2, access: 0.2, demand: 0.1 },
      weightsSource: 'ahp-final',
      kdeP99: 0,
      minLandFrac: 0.5,
    },
  }
}

describe('SuitabilityDistributionPanel 得分分布与统计行', () => {
  it('无数据且非 loading：显示「暂无数据」且不渲染直方图', () => {
    const wrapper = mount(SuitabilityDistributionPanel, {
      props: { data: null, loading: false },
    })

    expect(wrapper.text()).toContain('暂无数据')
    expect(wrapper.findComponent({ name: 'BarChart' }).exists()).toBe(false)
    expect(wrapper.find('.chart-loading-stub').exists()).toBe(false)
    expect(wrapper.find('[data-stat="count"] .stat-value').text()).toBe('0')
    expect(wrapper.find('[data-stat="max"] .stat-value').text()).toBe('—')
    expect(wrapper.find('[data-stat="avg"] .stat-value').text()).toBe('—')
    expect(wrapper.find('[data-stat="high"] .stat-value').text()).toBe('0')
  })

  it('有数据：0..1 按十档分桶，统计行汇总格数/最高分/平均分/score≥0.8 格数', () => {
    const wrapper = mount(SuitabilityDistributionPanel, {
      props: { data: makeResponse([0.05, 0.15, 0.25, 0.85, 0.95, 1]) },
    })

    expect(wrapper.text()).not.toContain('暂无数据')
    const chart = wrapper.findComponent({ name: 'BarChart' })
    expect(chart.exists()).toBe(true)
    expect(chart.props('xData')).toHaveLength(10)

    const series = chart.props('series') as Array<{ name: string; data: number[] }>
    // 0.05→[0,0.1) / 0.15→[0.1,0.2) / 0.25→[0.2,0.3) / 0.85→[0.8,0.9)
    // 0.95 与 1.0 入末档 [0.9,1.0]
    expect(series[0].data).toEqual([1, 1, 1, 0, 0, 0, 0, 0, 1, 2])

    expect(wrapper.find('[data-stat="count"] .stat-value').text()).toBe('6')
    expect(wrapper.find('[data-stat="max"] .stat-value').text()).toBe('1.000')
    expect(wrapper.find('[data-stat="avg"] .stat-value').text()).toBe('0.542')
    expect(wrapper.find('[data-stat="high"] .stat-value').text()).toBe('3')
  })

  it('loading 且无数据：只显示加载态，不显示「暂无数据」', () => {
    const wrapper = mount(SuitabilityDistributionPanel, {
      props: { data: null, loading: true },
    })

    expect(wrapper.find('.chart-loading-stub').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('暂无数据')
  })
})

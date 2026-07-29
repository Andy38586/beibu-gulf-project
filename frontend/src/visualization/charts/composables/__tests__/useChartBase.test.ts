/**
 * P0-01 回归测试：图表 props 更新必须反映到 getOption 输出
 *
 * 策略：mock useECharts，捕获 useChartBase 传入的 getOption，
 * 验证其在 props 变化前后返回不同的（新的）数据。
 * 这样测试聚焦"快照 bug"本身，不依赖 jsdom 中 echarts 的真实渲染。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

interface Captured {
  getOption: (() => any) | null
  updateChartCalls: number
}

// vi.hoisted 保证变量在 vi.mock 工厂提升后可用
const { captured } = vi.hoisted<{ captured: Captured }>(() => ({
  captured: { getOption: null, updateChartCalls: 0 },
}))

vi.mock('@/visualization/composables/useECharts', () => ({
  useECharts: (opts: any) => {
    captured.getOption = opts.getOption
    return {
      chartRef: { value: null },
      updateChart: () => {
        captured.updateChartCalls++
      },
      getInstance: () => null,
    }
  },
}))

import BarChart from '../../BarChart.vue'
import LineChart from '../../LineChart.vue'

describe('P0-01 回归：useChartBase 不得返回过期快照', () => {
  it('LineChart：xData/series 更新后 getOption 返回新数据', async () => {
    const wrapper = mount(LineChart, {
      props: {
        title: '趋势',
        xData: ['2024'],
        series: [{ name: '钦州港', data: [100] }],
      },
    })

    const before = captured.getOption!()
    expect(before.xAxis.data).toEqual(['2024'])
    expect(before.series[0].data).toEqual([100])

    await wrapper.setProps({
      xData: ['2024', '2025'],
      series: [{ name: '钦州港', data: [100, 230] }],
    })

    const after = captured.getOption!()
    expect(after.xAxis.data).toEqual(['2024', '2025'])
    expect(after.series[0].data).toEqual([100, 230])

    wrapper.unmount()
  })

  it('BarChart：title 更新后 getOption 返回新标题', async () => {
    const wrapper = mount(BarChart, {
      props: { title: '旧标题', xData: ['A'], series: [{ name: 's', data: [1] }] },
    })
    expect(captured.getOption!().title.text).toBe('旧标题')

    await wrapper.setProps({ title: '新标题' })
    expect(captured.getOption!().title.text).toBe('新标题')

    wrapper.unmount()
  })

  it('结构不变量：option 的静态结构与修复前保持一致', () => {
    mount(LineChart, {
      props: { title: 'T', xData: ['x'], series: [{ name: 'n', data: [1] }] },
    })
    const option = captured.getOption!()

    // 以下键值与修复前逐字节一致（防止修复时手滑改结构）
    expect(option.backgroundColor).toBe('transparent')
    expect(option.grid).toEqual({ top: 40, right: 16, bottom: 40, left: 40 })
    expect(option.title.left).toBe('center')
    expect(option.title.textStyle).toEqual({ color: '#303133', fontSize: 16, fontWeight: 600 })
    expect(option.tooltip).toEqual({ trigger: 'axis' })
    expect(option.legend.bottom).toBe(0)
    expect(option.xAxis.type).toBe('category')
    expect(option.yAxis.type).toBe('value')
    expect(option.series[0].type).toBe('line')
    // LineChart 的 seriesConfig 透传检查
    expect(option.series[0].smooth).toBe(true)
  })

  it('空 props 防御：缺省 xData/series 不报错', () => {
    mount(LineChart, { props: { title: 'T', xData: [], series: [] } })
    const option = captured.getOption!()
    expect(option.xAxis.data).toEqual([])
    expect(option.series).toEqual([])
  })
})

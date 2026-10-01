// @vitest-environment jsdom
/**
 * PortSplitPanel 单元测试：只钉渲染契约（组件零请求 / 零 store 依赖）。
 * 覆盖：空态、加载态不出现误导性 0、多港口行值 + 合计 + 占比、
 * 缺失/undefined 数值字段按 0 容错、超过行预算截断且合计诚实。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PortSplitPanel from '../PortSplitPanel.vue'

type PortRow = { coal?: number; grain?: number; ironOre?: number; total?: number }

function mountPanel(byPort: Record<string, PortRow | null> | null, loading = false) {
  return mount(PortSplitPanel, { props: { byPort, loading } })
}

/** tbody 每行 → 单元格文本数组（含合计行） */
function bodyRows(wrapper: ReturnType<typeof mount>): string[][] {
  return wrapper
    .findAll('.port-table tbody tr')
    .map((tr) => tr.findAll('td').map((td) => td.text()))
}

describe('PortSplitPanel 三港分摊明细', () => {
  it('无结果时显示「暂无数据」且不渲染表格', () => {
    const wrapper = mountPanel(null)

    expect(wrapper.find('.port-state').text()).toBe('暂无数据')
    expect(wrapper.find('.port-table').exists()).toBe(false)
  })

  it('加载中且无数据时显示加载态，不出现误导性的 0.00', () => {
    const wrapper = mountPanel(null, true)

    expect(wrapper.find('.port-state').text()).toBe('加载中…')
    expect(wrapper.text()).not.toContain('0.00')
    expect(wrapper.find('.port-table').exists()).toBe(false)
  })

  it('多港口：行值 2 位小数、合计逐列求和、占比 1 位小数（分母为全部合计）', () => {
    const wrapper = mountPanel({
      北海港: { coal: 120, grain: 80, ironOre: 200, total: 400 },
      钦州港: { coal: 30, grain: 20, ironOre: 50, total: 100 },
      防城港: { coal: 60, grain: 40, ironOre: 100, total: 200 },
    })

    expect(wrapper.findAll('.port-table thead th').map((th) => th.text())).toEqual([
      '港口',
      '煤炭',
      '粮食',
      '铁矿石',
      '合计',
      '占比(%)',
    ])
    expect(bodyRows(wrapper)).toEqual([
      ['北海港', '120.00', '80.00', '200.00', '400.00', '57.1'],
      ['钦州港', '30.00', '20.00', '50.00', '100.00', '14.3'],
      ['防城港', '60.00', '40.00', '100.00', '200.00', '28.6'],
      ['合计', '210.00', '140.00', '350.00', '700.00', '100.0'],
    ])
  })

  it('数值字段缺失/undefined 按 0 处理，不崩溃', () => {
    const wrapper = mountPanel({
      北海港: { coal: 10, total: 30 },
      钦州港: {},
      防城港: { grain: 5, total: 20, ironOre: undefined },
    })

    expect(bodyRows(wrapper)).toEqual([
      ['北海港', '10.00', '0.00', '0.00', '30.00', '60.0'],
      ['钦州港', '0.00', '0.00', '0.00', '0.00', '0.0'],
      ['防城港', '0.00', '5.00', '0.00', '20.00', '40.0'],
      ['合计', '10.00', '5.00', '0.00', '50.00', '100.0'],
    ])
  })

  it('港口数超过 8 行预算时截断显示，但合计/占比按全部港口计算并提示', () => {
    const byPort: Record<string, PortRow> = {}
    for (let i = 1; i <= 10; i++) byPort[`港口${i}`] = { total: i * 10 }

    const wrapper = mountPanel(byPort)
    const rows = bodyRows(wrapper)

    // 8 个港口行 + 1 个合计行；被截断的 港口9/港口10 不出现
    expect(rows).toHaveLength(9)
    expect(rows[0]?.[0]).toBe('港口1')
    expect(rows[7]?.[0]).toBe('港口8')
    expect(rows.some((r) => r[0] === '港口9' || r[0] === '港口10')).toBe(false)
    expect(rows[8]?.[0]).toBe('合计')
    // 合计诚实：10+20+...+100 = 550，而不是只加可见的 1..8（360）
    expect(rows[8]?.[4]).toBe('550.00')
    expect(rows[8]?.[5]).toBe('100.0')
    expect(wrapper.text()).toContain('仅显示前 8 / 10 个港口')
  })

  it('港口键完全来自响应，不依赖封闭三港清单', () => {
    const wrapper = mountPanel({ 自定义测试港: { total: 1 } })

    expect(wrapper.find('.port-table tbody tr td').text()).toBe('自定义测试港')
    expect(wrapper.text()).not.toContain('北海港')
  })
})

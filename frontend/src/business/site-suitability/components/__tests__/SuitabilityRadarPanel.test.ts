// @vitest-environment jsdom
/**
 * 五准则雷达面板（新选址样式对齐旧版选址页）：
 * ① 取**得分最高**的格子作为展示对象（不是首个，也不是随机）；
 * ② 五轴标签 = 准则中文名且顺序与共享 CRITERIA 一致（单一事实源）；
 * ③ 面板底部显示综合得分；无数据时不渲染图表（走空态）。
 * 阳性对照：把 peak 换成 features[0] / 轴序改乱 ⇒ 本文件必红。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

interface RadarOptionLike {
  title: { text: string }
  radar: { indicator: Array<{ name: string; max: number }> }
  series: Array<{ type: string; data: Array<{ value: number[] }> }>
  tooltip: { confine?: boolean }
}

const captured: { option: RadarOptionLike | null } = { option: null }

vi.mock('echarts/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('echarts/core')>()
  return {
    ...mod,
    init: vi.fn(() => ({
      setOption: vi.fn((o: RadarOptionLike) => {
        captured.option = o
      }),
      on: vi.fn(),
      off: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
    })),
    use: vi.fn(),
  }
})
// useECharts 除雷达外还会注册折线/柱状与 Grid/Legend（它自己的注册表），mock 必须齐备
vi.mock('echarts/charts', () => ({ RadarChart: {}, LineChart: {}, BarChart: {} }))
vi.mock('echarts/components', () => ({
  GridComponent: {},
  LegendComponent: {},
  TitleComponent: {},
  TooltipComponent: {},
}))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

import SuitabilityRadarPanel from '../SuitabilityRadarPanel.vue'

/** 两格夹具：低分在前、高分在后（若实现取 features[0]，轴值与得分都会错） */
function fixture() {
  return {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [108.5, 21.7] },
        properties: { id: 1, score: 0.4, inundation: 1, terrain: 0, land: 0, access: 0, demand: 0 },
      },
      {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [108.6, 21.8] },
        properties: {
          id: 2,
          score: 0.9,
          inundation: 0.25,
          terrain: 0.5,
          land: 0.75,
          access: 1,
          demand: 0.5,
        },
      },
    ],
    metadata: {
      count: 2,
      weights: { inundation: 0.4, terrain: 0.1, land: 0.2, access: 0.2, demand: 0.1 },
      weightsSource: 'ahp-final',
      kdeP99: 0,
      minLandFrac: 0.5,
    },
  }
}

describe('SuitabilityRadarPanel', () => {
  it('取最高分格子作答，五轴为准则中文名且顺序固定', () => {
    mount(SuitabilityRadarPanel, { props: { data: fixture() as never } })
    const o = captured.option
    if (!o) throw new Error('未捕获 option（组件未在挂载时 setOption？）')
    expect(o.radar.indicator.map((i) => i.name)).toEqual([
      '浸没安全',
      '地形施工',
      '土地适宜',
      '交通可达',
      '产业需求',
    ])
    expect(o.radar.indicator.every((i) => i.max === 1)).toBe(true)
    // 最高分格（id=2）的五个子分，顺序与轴一致
    expect(o.series[0].data[0].value).toEqual([0.25, 0.5, 0.75, 1, 0.5])
    expect(o.tooltip.confine).toBe(true)
  })

  it('底部显示综合得分（最高分格，3 位小数）', () => {
    const w = mount(SuitabilityRadarPanel, { props: { data: fixture() as never } })
    expect(w.text()).toContain('综合得分')
    expect(w.text()).toContain('0.900')
  })

  it('无数据时不挂载图表容器，显示空态（v-if：容器随数据出现）', () => {
    const w = mount(SuitabilityRadarPanel, { props: { data: null } })
    expect(w.find('.suit-radar-chart').exists()).toBe(false)
    expect(w.text()).toContain('暂无数据')
  })
})

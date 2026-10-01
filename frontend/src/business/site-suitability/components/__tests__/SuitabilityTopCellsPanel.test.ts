// @vitest-environment jsdom
/**
 * SuitabilityTopCellsPanel 契约测试：
 * ①无数据空态；②按 score 降序 + 坐标/得分精度 + 得分条宽度；③Top-N 上限 8；
 * ④点击行走既有 useMapControls.flyTo 通道定位。
 * 只 mock @/core 的外部地图通道，面板排序/格式化走真实实现。
 */
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ flyTo: vi.fn() }))

vi.mock('@/core', () => ({
  useMapControls: () => ({ flyTo: h.flyTo }),
}))

import type { SiteSuitabilityResponseParsed } from '@/types/schemas'

import SuitabilityTopCellsPanel from '../SuitabilityTopCellsPanel.vue'

interface CellSpec {
  id: number
  score: number
  lng: number
  lat: number
}

function makeResponse(cells: CellSpec[]): SiteSuitabilityResponseParsed {
  return {
    type: 'FeatureCollection',
    features: cells.map((cell) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [cell.lng, cell.lat] },
      properties: { id: cell.id, score: cell.score },
    })),
    metadata: {
      count: cells.length,
      weights: { inundation: 0.4, terrain: 0.1, land: 0.2, access: 0.2, demand: 0.1 },
      weightsSource: 'ahp-final',
      kdeP99: 0,
      minLandFrac: 0.5,
    },
  }
}

describe('SuitabilityTopCellsPanel 高分候选列表', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('无数据且非 loading：显示「暂无数据」且无候选行', () => {
    const wrapper = mount(SuitabilityTopCellsPanel, {
      props: { data: null, loading: false },
    })

    expect(wrapper.text()).toContain('暂无数据')
    expect(wrapper.findAll('.cell-row')).toHaveLength(0)
  })

  it('按 score 降序排列：排名 / 经纬度 4 位 / score 3 位 / 得分条宽度=score', () => {
    const wrapper = mount(SuitabilityTopCellsPanel, {
      props: {
        data: makeResponse([
          { id: 1, score: 0.5, lng: 108.123456, lat: 21.654321 },
          { id: 2, score: 0.9, lng: 109.111111, lat: 20.222222 },
          { id: 3, score: 0.7, lng: 110.999999, lat: 22.000011 },
        ]),
      },
    })

    const rows = wrapper.findAll('.cell-row')
    expect(rows).toHaveLength(3)
    expect(rows[0].find('.cell-rank').text()).toBe('1')
    expect(rows[0].find('.cell-coord').text()).toBe('109.1111, 20.2222')
    expect(rows[0].find('.cell-score').text()).toBe('0.900')
    expect(rows[1].find('.cell-score').text()).toBe('0.700')
    expect(rows[2].find('.cell-score').text()).toBe('0.500')
    // 横向得分条宽度与 score 同比例
    expect(rows[0].find('.cell-bar__fill').attributes('style')).toContain('width: 90%')
    expect(rows[2].find('.cell-bar__fill').attributes('style')).toContain('width: 50%')
  })

  it('Top-N 上限 8：12 个候选只渲染前 8 名', () => {
    const cells = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      score: (i + 1) / 100,
      lng: 108 + i * 0.01,
      lat: 21 + i * 0.01,
    }))
    const wrapper = mount(SuitabilityTopCellsPanel, { props: { data: makeResponse(cells) } })

    const rows = wrapper.findAll('.cell-row')
    expect(rows).toHaveLength(8)
    expect(rows[0].find('.cell-score').text()).toBe('0.120')
    expect(rows[7].find('.cell-score').text()).toBe('0.050')
    expect(wrapper.text()).not.toContain('0.040')
  })

  it('点击候选行：复用既有 flyTo 通道定位到该格', async () => {
    const wrapper = mount(SuitabilityTopCellsPanel, {
      props: {
        data: makeResponse([{ id: 1, score: 0.8, lng: 108.123456, lat: 21.654321 }]),
      },
    })

    await wrapper.find('.cell-row').trigger('click')

    expect(h.flyTo).toHaveBeenCalledTimes(1)
    expect(h.flyTo).toHaveBeenCalledWith({ lng: 108.123456, lat: 21.654321 }, { height: 1000 })
  })

  it('loading 且无数据：显示计算中，不显示「暂无数据」', () => {
    const wrapper = mount(SuitabilityTopCellsPanel, {
      props: { data: null, loading: true },
    })

    expect(wrapper.text()).toContain('计算中')
    expect(wrapper.text()).not.toContain('暂无数据')
  })
})

// @vitest-environment jsdom
/**
 * FloodAnalysisReportPanel z039④ 信息增补：
 * ①设施分类统计（type 聚合挂「受影响设施」行 title）；②档位对齐披露（请求≠实际 ⇒ ⇧+提示）。
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// useGCS 需要 GCS 容器上下文；本用例只验证信息行，打桩为固定 cell 值
vi.mock('@/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared')>()
  return {
    ...actual,
    useGCS: () => ({ cellPixel: { value: 48 }, css: { cell16px: '16px' } }),
  }
})

import { useFloodStore } from '@/stores'

import FloodAnalysisReportPanel from '../FloodAnalysisReportPanel.vue'

const facility = (id: string, type: string) => ({
  id,
  name: `设施${id}`,
  type,
  lng: 108.5,
  lat: 21.7,
  loss: 10,
  damageRate: 0.1,
})

describe('FloodAnalysisReportPanel — z039④ 信息增补', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('设施分类统计：按 type 聚合（数量降序）到「受影响设施」行 title，空类型归未分类', () => {
    const store = useFloodStore()
    store.floodStatistics = { riskLevel: '低风险' }
    store.affectedFacilities = [
      facility('a', '港口码头'),
      facility('b', '堆场'),
      facility('c', '港口码头'),
      facility('d', ''),
    ]

    const wrapper = mount(FloodAnalysisReportPanel)
    const row = wrapper.findAll('.info-item').find((r) => r.text().includes('受影响设施'))
    expect(row?.find('.info-value').attributes('title')).toBe('港口码头 2 · 堆场 1 · 未分类 1')
    wrapper.unmount()
  })

  it('档位对齐：请求 4.5 → 实际 5 ⇒ 淹没面积行出现 ⇧ 与提示', () => {
    const store = useFloodStore()
    store.floodStatistics = {
      riskLevel: '低风险',
      requestedWaterLevel: 4.5,
      actualWaterLevel: 5,
      waterLevel: 5,
    }

    const wrapper = mount(FloodAnalysisReportPanel)
    const mark = wrapper.find('.level-adjust-mark')
    expect(mark.exists()).toBe(true)
    expect(mark.attributes('title')).toContain('请求 4.5m 档 → 实际取 5m 档')
    wrapper.unmount()
  })

  it('阳性对照：请求=实际（或字段缺失）⇒ 不显示 ⇧', () => {
    const store = useFloodStore()
    store.floodStatistics = {
      riskLevel: '低风险',
      requestedWaterLevel: 5,
      actualWaterLevel: 5,
    }
    const wrapper = mount(FloodAnalysisReportPanel)
    expect(wrapper.find('.level-adjust-mark').exists()).toBe(false)
    wrapper.unmount()
  })
})

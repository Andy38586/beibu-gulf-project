import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { panelGridCapacity } from '@/shared'
import { useMapStore } from '@/stores'
import type { MapRenderer } from '@/types'

import LayerControlPanel from '../components/LayerControlPanel.vue'

// c043 判据：面板条目容量 + 流出条目必须可达。
//
// 不写"条目数 ≤ 8"这种钉死常数的断言：目录条目是**运行期派生**的（首屏 12、航线页 14，
// 见台账 c043 的探针 `groups=5 imagery=3`+extra），钉 8/13/14 都会随目录变化失效。
// 真正要钉的是两件事：
//   ① 容量要能从公式推出来（panelGridCapacity），不靠组件注释里的"正好填满"；
//   ② 派生条目数超出容量时，条目**必须有可达出口**——此前只有 GCSPanel:146 的
//      `overflow:hidden` 在裁，静默丢 6 个开关，无断言无收纳无出口。
const PANEL_HEIGHT_CELLS = 4 // 三处控制面板统一 4×4（Layer / SiteAnalysis / Forecast）

describe('c043 LayerControlPanel 容量与溢出出口', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('🔴 注入 capacity+1 条：不得静默裁切，容器必须提供滚动出口', () => {
    const mapStore = useMapStore()
    mapStore.setCurrentRenderer({ getType: () => '2d' } as unknown as MapRenderer)

    const capacity = panelGridCapacity({ heightCells: PANEL_HEIGHT_CELLS })
    expect(capacity).toBeGreaterThan(0)

    for (let i = 0; i < capacity + 1; i++) {
      mapStore.registerBusinessLayer(`layer-${i}`, `图层${i}`, 'points', false, ['openlayers'])
    }

    const wrapper = mount(LayerControlPanel)
    // 前提断言：本次注入确实超限（否则用例会退化成恒真摆设）
    expect(wrapper.findAll('.layer-btn').length).toBeGreaterThan(capacity)

    const grid = wrapper.find('.layer-grid')
    expect(grid.exists()).toBe(true)
    // 溢出出口：属性是样式出口的可断言锚（jsdom 不做布局，无法用 scrollHeight 判）
    expect(grid.attributes('data-overflow-exit')).toBe('scroll')
  })

  it('容量按公式随面板高度/档位推导（禁钉 8/13/14 常数）', () => {
    expect(panelGridCapacity({ heightCells: 4 })).toBe(8)
    expect(panelGridCapacity({ heightCells: 5 })).toBe(10)
    expect(panelGridCapacity({ heightCells: 3 })).toBe(6)
    // 比例全用 cell 表达 ⇒ 容量不随 cellPixel 漂移（桌面 80 / 大屏 90 / 抽屉 70）
    for (const cellPx of [70, 80, 90]) {
      expect(panelGridCapacity({ heightCells: 4, cellPx })).toBe(8)
    }
  })

  it('条目数未超容量时同样是合法终态（出口在位不等于必须溢出）', () => {
    const mapStore = useMapStore()
    mapStore.setCurrentRenderer({ getType: () => '2d' } as unknown as MapRenderer)
    mapStore.registerBusinessLayer('only-one', '唯一图层', 'points', false, ['openlayers'])

    const wrapper = mount(LayerControlPanel)
    expect(wrapper.findAll('.layer-btn').length).toBeLessThanOrEqual(
      panelGridCapacity({ heightCells: PANEL_HEIGHT_CELLS })
    )
    expect(wrapper.find('.layer-grid').attributes('data-overflow-exit')).toBe('scroll')
  })
})

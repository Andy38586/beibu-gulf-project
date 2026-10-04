// @vitest-environment jsdom
/**
 * HomePage 位置派生判据（2026-10-04 位置收表）：
 * ①注册表在 1320×800 strict 下零重叠不溢出不越界；
 * ②cell=80 派生值等于旧模板字面量（像素零变化）；
 * ③cell=70 顶边贴标题行（旧字面量差 2.5px 即红）；
 * ④cell=70 下挂载页面：GCSPanel 收到的 props 跟随注册表——位置回写字面量即红，
 *   不依赖文本扫描（任意记法改回硬编码都会与派生值不符）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import { GCSPanel } from '@/core'
import { computeLayout, findOverlaps, placementsFor, SAFE_MARGIN, useGCS } from '@/shared'

import HomePage from '../HomePage.vue'
import { HOME_PANELS } from '../panels'

vi.mock('@/business', () => ({
  useOverviewCharts: () => ({
    chartData: { labels: [], series: [] },
    barData: { labels: [], series: [] },
    loadOverviewCharts: vi.fn(),
  }),
}))

/** 真实 AppLayout 依赖路由/地图/store：以渲染命名插槽的替身承接布局骨架 */
const AppLayoutStub = defineComponent({
  name: 'AppLayout',
  setup(_, { slots }) {
    return () => h('div', { class: 'stub-app-layout' }, [slots.left?.(), slots.right?.()])
  },
})

describe('HomePage 位置派生（注册表 → props）', () => {
  it('1320×800 strict：零重叠 + 不溢出 + 不越界', () => {
    const layout = computeLayout(HOME_PANELS, { width: 1320, height: 800 }, 'desktop', {
      strict: true,
    })
    expect(layout.overflow).toEqual([])
    expect(findOverlaps(layout.rects)).toEqual([])
    for (const r of layout.rects) {
      expect(r.x).toBeGreaterThanOrEqual(SAFE_MARGIN)
      expect(r.x + r.w).toBeLessThanOrEqual(1320 - SAFE_MARGIN)
      expect(r.y + r.h).toBeLessThanOrEqual(800 - SAFE_MARGIN)
    }
  })

  it('cell=80 派生值等于旧字面量 1.25/5.5（像素零变化）', () => {
    expect(placementsFor(HOME_PANELS, 80)).toEqual({
      trend: { w: 4, h: 4, anchor: 'top-left', offsetX: 0, offsetY: 1.25 },
      compare: { w: 4, h: 4, anchor: 'top-left', offsetX: 0, offsetY: 5.5 },
    })
  })

  it('cell=70 首面板顶边贴标题行底（旧字面量差 2.5px 即红）', () => {
    const first = placementsFor(HOME_PANELS, 70).trend
    expect(20 + first.offsetY * 70).toBeCloseTo(110)
  })

  it('cell=70 挂载：面板 props 跟随注册表（回写字面量即红）', () => {
    const { cellPixel } = useGCS()
    const original = cellPixel.value
    cellPixel.value = 70
    try {
      const derived70 = placementsFor(HOME_PANELS, 70)
      // 阳性对照：两档派生值确实不同（否则本用例对"回写字面量"零分辨力）
      expect(derived70.trend.offsetY).not.toBe(1.25)

      const wrapper = mount(HomePage, {
        global: { stubs: { AppLayout: AppLayoutStub, LineChart: true, BarChart: true } },
      })
      const panels = wrapper.findAllComponents(GCSPanel)
      expect(panels).toHaveLength(2)
      expect(panels[0].props()).toMatchObject(derived70.trend)
      expect(panels[1].props()).toMatchObject(derived70.compare)
      wrapper.unmount()
    } finally {
      cellPixel.value = original
    }
  })
})

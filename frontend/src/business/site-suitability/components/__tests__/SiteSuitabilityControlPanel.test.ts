// @vitest-environment jsdom

/**
 * SiteSuitabilityControlPanel 权重卡片契约测试（滑块统一收进 SliderSelectCard 的机器判据）：
 * ①默认渲染只有按钮卡片，0 个 input[type=range]；
 * ②点击准则卡片后才出现滑块，滑块值=store 当前权重；
 * ③拖动滑块写 store.setWeight（归一化保持和=1，既有业务行为不变）；
 * ④点面板外部回到已选态（滑块收起，状态文案=权重）；
 * ⑤陆地占比档位是按钮（非滑块），点击写 store，行为不变。
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { effectScope } from 'vue'

import { useSliderFocus } from '@/core'
import { useSiteSuitabilityStore } from '@/stores'
import { SNAPSHOT_WEIGHTS } from '@/stores/siteSuitabilityDefaults.snapshot'

import SiteSuitabilityControlPanel from '../SiteSuitabilityControlPanel.vue'

/** 按标签定位已选态（button）卡片：展开后该卡片不再是 button，索引会漂移 */
function cardByLabel(wrapper: ReturnType<typeof mount>, label: string) {
  const card = wrapper.findAll('button.ssc').find((c) => c.find('.ssc-label').text() === label)
  if (!card) throw new Error(`未找到卡片 ${label}`)
  return card
}

describe('SiteSuitabilityControlPanel 权重卡片', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('默认渲染：五个准则都是按钮卡片，不出现任何 range 滑块', () => {
    const wrapper = mount(SiteSuitabilityControlPanel)

    expect(wrapper.findAll('input[type="range"]')).toHaveLength(0)
    expect(wrapper.findAll('button.ssc')).toHaveLength(5)
    expect(wrapper.findAll('.ssc-label').map((n) => n.text())).toEqual([
      '浸没安全',
      '地形施工',
      '土地适宜',
      '交通可达',
      '产业需求',
    ])
    // 已选态状态文案 = 当前权重（初值由快照派生，禁手抄旧 0.4/0.1/0.2/0.2/0.1）
    expect(wrapper.findAll('.ssc-status').map((n) => n.text())).toEqual(
      ['inundation', 'terrain', 'land', 'access', 'demand'].map(
        (k) => `${Math.round(SNAPSHOT_WEIGHTS[k as keyof typeof SNAPSHOT_WEIGHTS] * 100)}%`
      )
    )

    wrapper.unmount()
  })

  it('点击卡片才渲染滑块，滑块值绑定 store 当前权重；单手风琴（同时最多一个滑块）', async () => {
    const wrapper = mount(SiteSuitabilityControlPanel)
    const state = useSiteSuitabilityStore()

    expect(wrapper.findAll('input[type="range"]')).toHaveLength(0)
    await cardByLabel(wrapper, '浸没安全').trigger('click')

    const sliders = wrapper.findAll('input[type="range"]')
    expect(sliders).toHaveLength(1)
    expect((sliders[0].element as HTMLInputElement).value).toBe(String(state.weights.inundation))
    expect(sliders[0].attributes('min')).toBe('0')
    expect(sliders[0].attributes('max')).toBe('1')
    expect(sliders[0].attributes('step')).toBe('0.05')

    // 点另一张卡片：前一张收起，仍只有 1 个滑块
    await cardByLabel(wrapper, '交通可达').trigger('click')
    expect(wrapper.findAll('input[type="range"]')).toHaveLength(1)
    expect((wrapper.find('input[type="range"]').element as HTMLInputElement).value).toBe(
      String(state.weights.access)
    )

    wrapper.unmount()
  })

  it('拖动滑块写 store.setWeight：归一化后五准则和仍为 1，状态文案同步', async () => {
    const wrapper = mount(SiteSuitabilityControlPanel)
    const state = useSiteSuitabilityStore()

    await cardByLabel(wrapper, '浸没安全').trigger('click')
    await wrapper.find('input[type="range"]').setValue('0.6')

    expect(state.weights.inundation).toBeCloseTo(0.6)
    const sum = Object.values(state.weights).reduce((acc, v) => acc + v, 0)
    expect(sum).toBeCloseTo(1)
    // 其余准则按原比例压缩：地形快照值 → 快照/其余和×0.4
    expect(state.weights.terrain).toBeCloseTo(
      (SNAPSHOT_WEIGHTS.terrain / (1 - SNAPSHOT_WEIGHTS.inundation)) * 0.4
    )

    // 仍处于选择态：状态文案随权重实时更新
    expect(wrapper.find('.ssc.selecting .ssc-status').text()).toBe('60%')

    wrapper.unmount()
  })

  it('点面板外部回到已选态：滑块收起、状态文案仍为权重', async () => {
    const wrapper = mount(SiteSuitabilityControlPanel)

    await cardByLabel(wrapper, '产业需求').trigger('click')
    expect(wrapper.findAll('input[type="range"]')).toHaveLength(1)

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('input[type="range"]')).toHaveLength(0)
    expect(cardByLabel(wrapper, '产业需求').find('.ssc-status').text()).toBe(
      `${Math.round(SNAPSHOT_WEIGHTS.demand * 100)}%`
    )

    wrapper.unmount()
  })

  it('权重滑块本体按下进入专注模式、松手退出（原 useSliderFocus 行为保留）', async () => {
    const originalWidth = window.innerWidth
    // 专注模式仅在 <960px 抽屉档生效（桌面档 beginSliderFocus 主动 return）
    Object.defineProperty(window, 'innerWidth', { value: 800, writable: true, configurable: true })
    const wrapper = mount(SiteSuitabilityControlPanel, { attachTo: document.body })
    const scope = effectScope()
    const sliderFocus = scope.run(() => useSliderFocus())!

    try {
      await cardByLabel(wrapper, '浸没安全').trigger('click')
      const slider = wrapper.find('input[type="range"]')
      slider.element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      await wrapper.vm.$nextTick()
      expect(sliderFocus.active.value).toBe(true)

      slider.element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
      await wrapper.vm.$nextTick()
      expect(sliderFocus.active.value).toBe(false)
    } finally {
      wrapper.unmount()
      scope.stop()
      Object.defineProperty(window, 'innerWidth', {
        value: originalWidth,
        writable: true,
        configurable: true,
      })
    }
  })

  it('陆地占比下限仍是按钮档位：点击写 store.minLandFrac', async () => {
    const wrapper = mount(SiteSuitabilityControlPanel)
    const state = useSiteSuitabilityStore()

    const fracBtns = wrapper.findAll('.frac-btn')
    expect(fracBtns.map((b) => b.text())).toEqual(['≥30%', '≥50%', '≥70%'])
    expect(fracBtns[1].classes()).toContain('sel') // 缺省 0.5

    await fracBtns[2].trigger('click')
    expect(state.minLandFrac).toBeCloseTo(0.7)
    expect(wrapper.findAll('.frac-btn')[2].classes()).toContain('sel')

    wrapper.unmount()
  })
})

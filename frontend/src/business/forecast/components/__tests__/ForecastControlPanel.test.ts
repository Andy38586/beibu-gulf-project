// @vitest-environment jsdom

/**
 * ForecastControlPanel 时间轴卡片契约测试（滑块统一收进 SliderSelectCard 的机器判据）：
 * ①默认渲染不出现 input[type=range]（时间轴=按钮卡片，状态文案=当前时间）；
 * ②点击卡片后才渲染滑块，值=当前步（年月双基换算不变）；
 * ③滑块输入写 store.currentTime（步→时间串仍走 ../timeline）；
 * ④年/月粒度切换后步值与上界同步（既有换算行为不变）；
 * ⑤可点击刻度跳年（选择步进不变），且点刻度不会把卡片收起；
 * ⑥滑块本体按下进入专注模式、松手退出（原 t-slider 的 beginSliderFocus/endSliderFocus 保留）。
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useSliderFocus } from '@/core'
import { useForecastStore } from '@/stores'

import { FORECAST_ORCHESTRATOR_KEY } from '../../composables/useForecastOrchestrator'
import ForecastControlPanel from '../ForecastControlPanel.vue'

/** v4-S3：面板从页面 inject 编排器（缺提供即抛错，设计如此）——测件按真实拓扑注入桩 */
const doForecastUpdate = vi.fn(() => Promise.resolve())
function mountPanel(attach = false) {
  return mount(ForecastControlPanel, {
    attachTo: attach ? document.body : undefined,
    global: {
      provide: { [FORECAST_ORCHESTRATOR_KEY]: { doForecastUpdate, cancelAll: vi.fn() } },
    },
  })
}

/** 时间轴卡片：展开后从 button 变 div，按标签定位 */
function timeCard(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('button.ssc').find((c) => c.find('.ssc-label').text() === '时间轴')
}

describe('ForecastControlPanel 时间轴卡片', () => {
  let originalWidth = 0

  beforeEach(() => {
    setActivePinia(createPinia())
    originalWidth = window.innerWidth
    // 专注模式仅在 <960px 抽屉档生效（桌面档 beginSliderFocus 主动 return）
    Object.defineProperty(window, 'innerWidth', { value: 800, writable: true, configurable: true })
  })

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      value: originalWidth,
      writable: true,
      configurable: true,
    })
  })

  it('默认渲染：时间轴是按钮卡片，不出现 range 滑块', () => {
    const wrapper = mountPanel()

    expect(wrapper.findAll('input[type="range"]')).toHaveLength(0)
    const card = timeCard(wrapper)
    expect(card).toBeTruthy()
    expect(card!.find('.ssc-status').text()).toBe('2026年06月')

    wrapper.unmount()
  })

  it('点击卡片才渲染滑块，滑块值=当前步、上界=月模式上限', async () => {
    const wrapper = mountPanel()

    expect(wrapper.findAll('input[type="range"]')).toHaveLength(0)
    await timeCard(wrapper)!.trigger('click')

    const sliders = wrapper.findAll('input[type="range"]')
    expect(sliders).toHaveLength(1)
    expect((sliders[0].element as HTMLInputElement).value).toBe('65')
    expect(sliders[0].attributes('min')).toBe('0')
    expect(sliders[0].attributes('max')).toBe('131')
    expect(sliders[0].attributes('step')).toBe('1')

    wrapper.unmount()
  })

  it('滑块输入写 store.currentTime，状态文案同步（月模式步→时间串）', async () => {
    const wrapper = mountPanel()
    const store = useForecastStore()

    await timeCard(wrapper)!.trigger('click')
    await wrapper.find('input[type="range"]').setValue('12')

    expect(store.currentTime).toBe('2022-01')
    expect(wrapper.find('.ssc.selecting .ssc-status').text()).toBe('2022年01月')

    wrapper.unmount()
  })

  it('年粒度切换：步值与上界切到年基（换算行为不变）', async () => {
    const wrapper = mountPanel()
    const store = useForecastStore()

    await timeCard(wrapper)!.trigger('click')
    await wrapper.find('.gr-toggle input').setValue(true)

    expect(store.timeGranularity).toBe('year')
    const slider = wrapper.find('input[type="range"]')
    expect(slider.attributes('max')).toBe('10')
    expect((slider.element as HTMLInputElement).value).toBe('5')

    await slider.setValue('10')
    expect(store.currentTime).toBe('2031')
    expect(wrapper.find('.ssc.selecting .ssc-status').text()).toBe('2031年')

    wrapper.unmount()
  })

  it('可点击刻度跳年（选择步进保留），点刻度不收起卡片', async () => {
    const wrapper = mountPanel()
    const store = useForecastStore()

    const ticks = wrapper.findAll('.t-tick.clickable')
    expect(ticks.map((t) => t.text())).toEqual(['2021.1', '2026.1', '2031.1'])

    await timeCard(wrapper)!.trigger('click')
    await ticks[2].trigger('click')

    expect(store.currentTime).toBe('2031-01')
    // 刻度在时间区内部：不触发「点外部收起」，滑块仍在
    expect(wrapper.findAll('input[type="range"]')).toHaveLength(1)

    wrapper.unmount()
  })

  it('滑块本体按下进入专注模式、松手退出（专注模式保留）', async () => {
    const wrapper = mountPanel(true)
    const scope = effectScope()
    const sliderFocus = scope.run(() => useSliderFocus())!

    // 收起态：卡片按钮按下不进入专注模式（只有滑块本体才算）
    const card = timeCard(wrapper)!
    card.element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(sliderFocus.active.value).toBe(false)

    // 展开后：滑块本体按下 → 专注；松手 → 退出
    await card.trigger('click')
    const slider = wrapper.find('input[type="range"]')
    slider.element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(sliderFocus.active.value).toBe(true)

    slider.element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(sliderFocus.active.value).toBe(false)

    wrapper.unmount()
    scope.stop()
  })

  it('点时间区外部收起卡片：回到已选态（无滑块）', async () => {
    const wrapper = mountPanel(true)
    const store = useForecastStore()

    await timeCard(wrapper)!.trigger('click')
    expect(wrapper.findAll('input[type="range"]')).toHaveLength(1)

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('input[type="range"]')).toHaveLength(0)
    expect(timeCard(wrapper)!.find('.ssc-status').text()).toBe('2026年06月')
    // 收起只是 UI 态：store 时间不变（业务状态不被收起动作改写）
    expect(store.currentTime).toBe('2026-06')

    wrapper.unmount()
  })

  // ── v4-S3：请求归属上移后，"用户改了什么"由本面板发起（判据在防抖窗口上） ──
  it('参数变化经 300ms 防抖调用一次编排器（连续两次变化只发一次）', async () => {
    vi.useFakeTimers()
    try {
      doForecastUpdate.mockClear()
      mountPanel()
      const store = useForecastStore()

      store.setCurrentTime('2027-01')
      store.setCurrentTime('2028-01')
      await vi.advanceTimersByTimeAsync(0)
      expect(doForecastUpdate).not.toHaveBeenCalled() // 防抖窗口内不发起

      await vi.advanceTimersByTimeAsync(300)
      expect(doForecastUpdate).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('卸载后防抖窗口内的那一次不再发起（与页面 cancelAll 互补）', async () => {
    vi.useFakeTimers()
    try {
      doForecastUpdate.mockClear()
      const wrapper = mountPanel()
      useForecastStore().setCurrentTime('2027-06')

      wrapper.unmount()
      await vi.advanceTimersByTimeAsync(400)
      expect(doForecastUpdate).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

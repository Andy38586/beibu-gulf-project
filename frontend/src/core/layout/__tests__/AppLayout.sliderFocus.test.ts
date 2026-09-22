// @vitest-environment jsdom
/**
 * 修复守卫：专注态激活期间切路由 ⇒ 旧页 AppLayout 卸载后
 * body 的 slider-focus-mode class 必须被摘除（否则全站面板永久 opacity:0）。
 *
 * 阳性对照：把 AppLayout.vue 的 onUnmounted 兜底删掉，本用例第二条必红
 * （机理 = 真 vue 3.5.41 实测：scope.stop() 丢弃排队的 pre-flush 回调，
 * useSliderFocus 的 onScopeDispose 把 active 置 false 也传不到已停的 watcher）。
 */
import { mount } from '@vue/test-utils'
import { effectScope } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPush = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/flood-analysis', name: 'Flood', meta: {} }),
  useRouter: () => ({ push: mockPush }),
}))

// 静态 import 的重子树全部打桩（本用例只测 body class 生命周期，不测图表/面板本身）
vi.mock('@/visualization', () => ({
  RadarChart: { template: '<div class="radar-stub" />' },
  SNAPSHOT_XIAOQU: { id: 'snap', name: 'snap', breakdown: {} },
  SNAPSHOT_SELECTED_TYPES: [],
}))
vi.mock('@/core/map/components/LayerControlPanel.vue', () => ({
  default: { template: '<div class="layer-panel-stub" />' },
}))

import AppLayout from '../AppLayout.vue'
import { useSliderFocus } from '../useSliderFocus'

const BODY_CLASS = 'slider-focus-mode'
let originalWidth: number

beforeEach(() => {
  setActivePinia(createPinia())
  originalWidth = window.innerWidth
  // <960px 抽屉档：beginSliderFocus 才生效（桌面档主动 return）
  Object.defineProperty(window, 'innerWidth', { value: 800, writable: true, configurable: true })
})

afterEach(() => {
  document.body.classList.remove(BODY_CLASS)
  document.body.innerHTML = ''
  Object.defineProperty(window, 'innerWidth', {
    value: originalWidth,
    writable: true,
    configurable: true,
  })
})

describe('AppLayout 滑块专注模式 body class 生命周期（c042）', () => {
  it('专注激活期间组件卸载：body class 必须被摘除（现状红 → 修复后绿）', async () => {
    const wrapper = mount(AppLayout)
    // 经 effectScope 拿模块单例（onScopeDispose 有处可挂，避免测试环境告警）
    const scope = effectScope()
    const sf = scope.run(() => useSliderFocus())!
    sf.beginSliderFocus(null)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(document.body.classList.contains(BODY_CLASS)).toBe(true)

    wrapper.unmount()
    expect(document.body.classList.contains(BODY_CLASS)).toBe(false)
    scope.stop()
  })

  it('未激活时卸载不误摘（无 class 也不报错）', async () => {
    const wrapper = mount(AppLayout)
    wrapper.unmount()
    expect(document.body.classList.contains(BODY_CLASS)).toBe(false)
  })
})

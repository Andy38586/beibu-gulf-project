import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import GCSPanel from '../GCSPanel.vue'

// GCSPanel compact 档降级单测（v4-S10）：<640px 自由拖拽禁用，长按 600ms 弹
// "停靠到后台"，停靠按钮即合成 dock zone 元素（页面 drop 契约零改动）。
// 事件用手动构造（jsdom 的 MouseEvent getter 只读，trigger 赋 clientX 会炸——
// usePanelDrag.test 同款手法）。

function setWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true, configurable: true })
  window.dispatchEvent(new Event('resize'))
}

/** G4 收口后档位唯一来源是 useGCS 的 150ms 防抖 resize —— 置宽后须先冲掉防抖再断言 */
function flushTierDebounce(): void {
  vi.advanceTimersByTime(200)
}

function fire(el: Element, type: string, x = 10, y = 10): void {
  const e = new Event(type, { bubbles: true }) as Event & {
    clientX: number
    clientY: number
    pointerId: number
    button: number
  }
  e.clientX = x
  e.clientY = y
  e.pointerId = 1
  e.button = 0
  el.dispatchEvent(e)
}

describe('GCSPanel compact 长按降级（v4-S10）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setWidth(500) // <640 → compact
    flushTierDebounce()
  })
  afterEach(() => {
    setWidth(1280)
    flushTierDebounce()
    vi.useRealTimers()
  })

  it('compact 档：手柄指针按下+移动不启动自由拖拽（降级生效）', async () => {
    const wrapper = mount(GCSPanel, { props: { w: 4, h: 4, draggable: true } })
    const handle = wrapper.find('.GCS-panel__drag-handle')
    fire(handle.element, 'pointerdown')
    fire(handle.element, 'pointermove', 60, 60)
    await nextTick()
    // 降级：没有进入拖拽（is-dragging class 不出现），也没有弹层
    expect(wrapper.classes()).not.toContain('is-dragging')
    expect(wrapper.find('.GCS-panel__dock-popup').exists()).toBe(false)
  })

  it('长按 600ms → 弹层出现；点「停靠」→ emit drop（合成元素带 dock 属性）', async () => {
    const wrapper = mount(GCSPanel, { props: { w: 4, h: 4, draggable: true } })
    const handle = wrapper.find('.GCS-panel__drag-handle')
    fire(handle.element, 'pointerdown')
    // 未满长按时长：无弹层（掐表逻辑生效）
    vi.advanceTimersByTime(300)
    await nextTick()
    expect(wrapper.find('.GCS-panel__dock-popup').exists()).toBe(false)
    vi.advanceTimersByTime(400) // 累计 700ms
    await nextTick()
    expect(wrapper.find('.GCS-panel__dock-popup').exists()).toBe(true)
    // 指针松开不清已出的弹层（等待用户选择）
    fire(handle.element, 'pointerup')
    await nextTick()
    expect(wrapper.find('.GCS-panel__dock-popup').exists()).toBe(true)

    const dockBtn = wrapper.find('[data-task-dock-zone]')
    expect(dockBtn.exists()).toBe(true)
    await dockBtn.trigger('click')
    const dropped = wrapper.emitted('drop')
    expect(dropped).toHaveLength(1)
    expect((dropped![0][0] as HTMLElement).hasAttribute('data-task-dock-zone')).toBe(true)
  })

  it('desktop 档不受影响：无长按弹层（自由拖拽由 usePanelDrag 既有测试兜底）', async () => {
    setWidth(1280)
    flushTierDebounce()
    const wrapper = mount(GCSPanel, { props: { w: 4, h: 4, draggable: true } })
    const handle = wrapper.find('.GCS-panel__drag-handle')
    fire(handle.element, 'pointerdown')
    vi.advanceTimersByTime(1200)
    await nextTick()
    expect(wrapper.find('.GCS-panel__dock-popup').exists()).toBe(false)
  })
})

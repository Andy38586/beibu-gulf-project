import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

import {
  DRAG_THRESHOLD_PX,
  TASK_DOCK_ZONE_ATTR,
  useGlobalPanelDragActive,
  usePanelDrag,
} from '../usePanelDrag'

/**
 * usePanelDrag 单测（v4-S4）
 * 覆盖状态机核心行为：4px 阈值、落点判定、cancel 回滚、投递回调。
 *
 * 测试策略：用最小宿主组件挂载 composable（onUnmounted 需组件上下文），
 * 直接分发 PointerEvent 到 window（监听挂在 window）。
 */

/** 被测 composable 的对外快照，供断言读取 */
let api: ReturnType<typeof usePanelDrag>

const Host = defineComponent({
  setup() {
    api = usePanelDrag({
      onDragStart: spy.start,
      onDragEnd: spy.end,
      onDrop: spy.drop,
      onCancel: spy.cancel,
    })
    return () =>
      h('div', {
        class: 'host',
        onPointerdown: api.onPointerDown,
      })
  },
})

const spy = {
  start: vi.fn(),
  end: vi.fn(),
  drop: vi.fn(),
  cancel: vi.fn(),
}

/** 造一个 PointerEvent（jsdom 无 PointerEvent，用 Event 兜底并补字段） */
function pointer(type: string, x: number, y: number, pointerId = 1, button = 0): Event {
  const e = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    clientX: number
    clientY: number
    pointerId: number
    button: number
  }
  e.clientX = x
  e.clientY = y
  e.pointerId = pointerId
  e.button = button
  return e
}

/** 向宿主元素分发 pointerdown（VTU trigger 造不出带 button 的指针事件） */
function downOnHost(x: number, y: number, pointerId = 1, button = 0): void {
  const host = wrapper.find('.host').element as HTMLElement
  host.dispatchEvent(pointer('pointerdown', x, y, pointerId, button))
}

/**
 * 挂一个 dock 投递区元素，并给它一个**以 (x, y) 为中心的矩形**。
 *
 * ## 🔴 为什么不再伪造 elementFromPoint（2026-09-19）
 *
 * 落点判定已从 `elementFromPoint` 改为**几何矩形点包含测试**
 * （真因：投递区常态 `pointer-events:none`，而命中测试按规范忽略这类元素
 * ⇒ 拖拽期永远命不中，见 `findDropZone` 注释）。
 *
 * jsdom 的 `getBoundingClientRect()` 恒返回全 0 矩形，因此这里必须显式
 * 给桩元素一个真实矩形，否则判定永远不命中 —— 这正是旧测试改成几何判定后
 * 立即失败的原因（旧断言固化的是已废弃的实现细节）。
 */
function stubDropZoneAt(x: number, y: number, half = 50): HTMLElement {
  const zone = document.createElement('div')
  zone.setAttribute(TASK_DOCK_ZONE_ATTR, 'flood-analysis')
  document.body.appendChild(zone)

  zone.getBoundingClientRect = () =>
    ({
      x: x - half,
      y: y - half,
      left: x - half,
      top: y - half,
      right: x + half,
      bottom: y + half,
      width: half * 2,
      height: half * 2,
      toJSON: () => ({}),
    }) as DOMRect

  return zone
}

/**
 * jsdom 未实现 document.elementFromPoint ⇒ 直接定义（不能 spy 不存在的属性）。
 * 每次伪造替换实现，默认为「命中 null」。
 */
function setElementFromPoint(fn: (x: number, y: number) => Element | null): void {
  ;(
    document as Document & { elementFromPoint: (x: number, y: number) => Element | null }
  ).elementFromPoint = fn
}

let wrapper: ReturnType<typeof mount>

beforeEach(() => {
  Object.values(spy).forEach((fn) => fn.mockClear())

  // 全局拖拽态是模块级单例：上个用例若在拖拽中被卸载，
  // afterEach 的 wrapper.unmount() → stop() → markGlobalDrag(false) 已复位。
  // 这里不额外重置，正是为了顺带验证「卸载必复位」这条不变量。

  // jsdom 未实现 pointer capture —— 补桩，验证是否被调用
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => true)
  // 默认：未命中任何投递区
  setElementFromPoint(() => null)

  wrapper = mount(Host, { attachTo: document.body })
})

afterEach(() => {
  wrapper.unmount()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('usePanelDrag', () => {
  it('初始态为 idle，位移为 0', () => {
    expect(api.phase.value).toBe('idle')
    expect(api.offsetX.value).toBe(0)
    expect(api.offsetY.value).toBe(0)
    expect(api.overZone.value).toBe(false)
  })

  it('pointerdown 进入 pending（尚未开始拖拽）', async () => {
    downOnHost(100, 100)
    await nextTick()
    expect(api.phase.value).toBe('pending')
    expect(spy.start).not.toHaveBeenCalled()
  })

  it('位移小于 4px 阈值不进入 dragging（防误触）', async () => {
    downOnHost(100, 100)
    window.dispatchEvent(pointer('pointermove', 100 + DRAG_THRESHOLD_PX - 1, 100))
    await nextTick()

    expect(api.phase.value).toBe('pending')
    expect(spy.start).not.toHaveBeenCalled()
  })

  it('位移达到阈值进入 dragging 并触发 onDragStart', async () => {
    downOnHost(100, 100)
    window.dispatchEvent(pointer('pointermove', 100 + DRAG_THRESHOLD_PX, 100))
    await nextTick()

    expect(api.phase.value).toBe('dragging')
    expect(spy.start).toHaveBeenCalledTimes(1)
  })

  it('拖拽中位移随指针更新（transform 数据源）', async () => {
    downOnHost(100, 100)
    window.dispatchEvent(pointer('pointermove', 160, 140))
    await nextTick()

    expect(api.offsetX.value).toBe(60)
    expect(api.offsetY.value).toBe(40)
  })

  it('🔴 拖拽中不抛出未捕获错误，即使 elementFromPoint 返回 null（不命中投递区）', async () => {
    downOnHost(100, 100)
    window.dispatchEvent(pointer('pointermove', 150, 150))
    await nextTick()
    expect(api.overZone.value).toBe(false)
  })

  it('overZone：指针进入投递区时置 true', async () => {
    stubDropZoneAt(300, 300)
    downOnHost(100, 100)
    window.dispatchEvent(pointer('pointermove', 300, 300))
    await nextTick()

    expect(api.overZone.value).toBe(true)
  })

  it('🔴 投递区 pointer-events:none 时仍能命中（几何判定，不依赖命中测试）', async () => {
    // 这是"拖到底部无响应"的根因回归锁：
    // 投递区常态必须 pointer-events:none（否则挡住导航条与地图交互），
    // 而 elementFromPoint 按规范忽略这类元素 ⇒ 若实现退回命中测试，本用例必失败。
    const zone = stubDropZoneAt(300, 300)
    zone.style.pointerEvents = 'none'
    // 命中测试对所有坐标都返回 null，模拟"投递区对 elementFromPoint 隐形"
    setElementFromPoint(() => null)

    downOnHost(100, 100)
    window.dispatchEvent(pointer('pointermove', 300, 300))
    await nextTick()
    expect(api.overZone.value).toBe(true)

    window.dispatchEvent(pointer('pointerup', 300, 300))
    await nextTick()
    expect(spy.drop).toHaveBeenCalledTimes(1)
    expect(spy.drop.mock.calls[0]![0]).toBe(zone)
  })

  it('指针在投递区矩形之外 ⇒ 不命中（回滚 cancel）', async () => {
    stubDropZoneAt(300, 300, 20) // 矩形 280~320
    downOnHost(100, 100)
    window.dispatchEvent(pointer('pointermove', 600, 500)) // 明确在矩形外
    await nextTick()
    expect(api.overZone.value).toBe(false)

    window.dispatchEvent(pointer('pointerup', 600, 500))
    await nextTick()
    expect(spy.cancel).toHaveBeenCalledTimes(1)
    expect(spy.drop).not.toHaveBeenCalled()
  })

  it('pointerup 命中投递区 ⇒ 触发 onDrop 并携带 zone 元素', async () => {
    const zone = stubDropZoneAt(300, 300)
    downOnHost(100, 100)
    window.dispatchEvent(pointer('pointermove', 300, 300))
    await nextTick()
    window.dispatchEvent(pointer('pointerup', 300, 300))
    await nextTick()

    expect(spy.drop).toHaveBeenCalledTimes(1)
    expect(spy.drop.mock.calls[0]![0]).toBe(zone)
    expect(spy.cancel).not.toHaveBeenCalled()
    expect(spy.end).toHaveBeenCalledTimes(1)
    expect(api.phase.value).toBe('idle')
  })

  it('pointerup 未命中 ⇒ 触发 onCancel 回滚，位移归零', async () => {
    downOnHost(100, 100)
    window.dispatchEvent(pointer('pointermove', 400, 400))
    await nextTick()
    window.dispatchEvent(pointer('pointerup', 400, 400))
    await nextTick()

    expect(spy.drop).not.toHaveBeenCalled()
    expect(spy.cancel).toHaveBeenCalledTimes(1)
    expect(spy.end).toHaveBeenCalledTimes(1)
    expect(api.phase.value).toBe('idle')
    expect(api.offsetX.value).toBe(0)
    expect(api.offsetY.value).toBe(0)
  })

  it('未越过阈值即 pointerup ⇒ 视为点击，不触发 drop/cancel', async () => {
    downOnHost(100, 100)
    window.dispatchEvent(pointer('pointermove', 101, 100))
    await nextTick()
    window.dispatchEvent(pointer('pointerup', 101, 100))
    await nextTick()

    expect(spy.drop).not.toHaveBeenCalled()
    expect(spy.cancel).not.toHaveBeenCalled()
    expect(spy.end).not.toHaveBeenCalled()
    expect(api.phase.value).toBe('idle')
  })

  it('pointercancel ⇒ 回滚（浏览器接管手势时不残留拖拽态）', async () => {
    downOnHost(100, 100)
    window.dispatchEvent(pointer('pointermove', 300, 300))
    await nextTick()
    window.dispatchEvent(pointer('pointercancel', 300, 300))
    await nextTick()

    expect(spy.cancel).toHaveBeenCalledTimes(1)
    expect(api.phase.value).toBe('idle')
    expect(api.offsetX.value).toBe(0)
  })

  it('pointerdown 时调用 setPointerCapture（拖出窗口不丢事件）', async () => {
    const host = wrapper.find('.host').element
    downOnHost(100, 100)
    await nextTick()

    expect(host.setPointerCapture).toHaveBeenCalledWith(1)
  })

  it('pointerup 时释放 pointer capture', async () => {
    const host = wrapper.find('.host').element
    downOnHost(100, 100)
    window.dispatchEvent(pointer('pointermove', 300, 300))
    await nextTick()
    window.dispatchEvent(pointer('pointerup', 300, 300))
    await nextTick()

    expect(host.releasePointerCapture).toHaveBeenCalledWith(1)
  })

  it('非左键（右键 button=2）不启动拖拽', async () => {
    downOnHost(100, 100, 1, 2)
    await nextTick()
    expect(api.phase.value).toBe('idle')
  })

  it('abort() 手动中止 ⇒ 回滚并复位', async () => {
    downOnHost(100, 100)
    window.dispatchEvent(pointer('pointermove', 300, 300))
    await nextTick()
    expect(api.phase.value).toBe('dragging')

    api.abort()
    await nextTick()

    expect(spy.cancel).toHaveBeenCalledTimes(1)
    expect(api.phase.value).toBe('idle')
    expect(api.offsetX.value).toBe(0)
  })

  it('ignored pointerId 的 move/up 不影响本次拖拽（多指场景隔离）', async () => {
    downOnHost(100, 100)
    window.dispatchEvent(pointer('pointermove', 300, 300, 99))
    await nextTick()

    // pointerId=99 不是本次拖拽的指针，位移不应更新
    expect(api.offsetX.value).toBe(0)
    expect(api.phase.value).toBe('pending')
  })

  it('卸载后 window 监听解除（不再响应 pointermove）', async () => {
    downOnHost(100, 100)
    wrapper.unmount()

    window.dispatchEvent(pointer('pointermove', 300, 300))
    await nextTick()

    // 卸载后即使收到事件也不应改状态（对象仍在但监听已摘）
    expect(api.offsetX.value).toBe(0)
  })

  /**
   * 全局拖拽态（2026-09-18 新增）—— 它是「空态 dock 投递区显形」的触发源。
   *
   * 🔴 没有它的话：空 dock 不渲染 ⇒ 投递区元素不存在
   *    ⇒ 首次拖拽 elementFromPoint 必然落空 ⇒ 「能拖但 dock 无响应」。
   */
  describe('全局拖拽态（dock 投递区显形的前提）', () => {
    it('进入 dragging 时置位，松手后复位', async () => {
      const active = useGlobalPanelDragActive()
      expect(active.value).toBe(false)

      downOnHost(100, 100)
      window.dispatchEvent(pointer('pointermove', 200, 200))
      await nextTick()
      expect(api.phase.value).toBe('dragging')
      expect(active.value).toBe(true)

      window.dispatchEvent(pointer('pointerup', 200, 200))
      await nextTick()
      expect(api.phase.value).toBe('idle')
      expect(active.value).toBe(false)
    })

    it('未越过阈值（仍 pending）不置位（防误触不应让 dock 闪出来）', async () => {
      const active = useGlobalPanelDragActive()
      downOnHost(100, 100)
      window.dispatchEvent(pointer('pointermove', 100 + DRAG_THRESHOLD_PX - 1, 100))
      await nextTick()

      expect(api.phase.value).toBe('pending')
      expect(active.value).toBe(false)
    })

    it('pointercancel 也复位（浏览器接管手势时不留残影）', async () => {
      const active = useGlobalPanelDragActive()
      downOnHost(100, 100)
      window.dispatchEvent(pointer('pointermove', 200, 200))
      await nextTick()
      expect(active.value).toBe(true)

      window.dispatchEvent(pointer('pointercancel', 200, 200))
      await nextTick()
      expect(active.value).toBe(false)
    })

    it('abort() 复位（外部强制中止时不留残影）', async () => {
      const active = useGlobalPanelDragActive()
      downOnHost(100, 100)
      window.dispatchEvent(pointer('pointermove', 200, 200))
      await nextTick()
      expect(active.value).toBe(true)

      api.abort()
      await nextTick()
      expect(active.value).toBe(false)
    })
  })
})

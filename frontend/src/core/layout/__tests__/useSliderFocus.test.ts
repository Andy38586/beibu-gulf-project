// @vitest-environment jsdom
/**
 * beginSliderFocusOnRange 守卫单测（三页滑块统一入口）：
 * 事件目标是原生 input[type=range] 才进入专注模式，卡片 label/状态文案按下不触发
 * （SliderSelectCard 根含文字节点，直接挂根会让点文字也隐藏其他面板）。
 * 收口前该守卫在浸没/预测/选址三页各手抄一份（dup 棘轮 business +18 咬住后收此）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useSliderFocus } from '../useSliderFocus'

function rangeInPanel(): HTMLElement {
  const panel = document.createElement('div')
  panel.className = 'GCS-panel'
  const range = document.createElement('input')
  range.type = 'range'
  panel.appendChild(range)
  document.body.appendChild(panel)
  return range
}

function pointerEvent(target: HTMLElement): PointerEvent {
  return { target } as unknown as PointerEvent
}

describe('beginSliderFocusOnRange —— 仅原生 range 触发专注', () => {
  afterEach(() => {
    // 单例状态复位，避免跨用例泄漏
    const { endSliderFocus } = useSliderFocus()
    endSliderFocus()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('target 是 input[type=range] ⇒ 进入专注模式并记录所在面板', () => {
    // desktop 档（≥960px）专注模式按设计不生效——jsdom 默认 1024，压到平板档
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800)
    const range = rangeInPanel()
    const { active, activePanel, beginSliderFocusOnRange } = useSliderFocus()
    beginSliderFocusOnRange(pointerEvent(range))
    expect(active.value).toBe(true)
    expect(activePanel.value).toBe(range.closest('.GCS-panel'))
  })

  it('target 是卡片文字（span）⇒ 不触发专注（守卫本义）', () => {
    const panel = document.createElement('div')
    panel.className = 'GCS-panel'
    const label = document.createElement('span')
    panel.appendChild(label)
    document.body.appendChild(panel)
    const { active, beginSliderFocusOnRange } = useSliderFocus()
    beginSliderFocusOnRange(pointerEvent(label))
    expect(active.value).toBe(false)
  })

  it('target 缺 matches（如 window）⇒ 静默不触发，不抛错', () => {
    const { active, beginSliderFocusOnRange } = useSliderFocus()
    expect(() => beginSliderFocusOnRange({ target: {} } as unknown as PointerEvent)).not.toThrow()
    expect(active.value).toBe(false)
  })
})

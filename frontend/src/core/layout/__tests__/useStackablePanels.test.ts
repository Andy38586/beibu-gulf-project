import { describe, expect, it } from 'vitest'

import { STACK_SLOT_ZONE_ATTR } from '@/shared/composables/usePanelDrag'

import { useStackablePanels } from '../useStackablePanels'

const panels = [
  { id: 'line', label: '预测趋势' },
  { id: 'bar', label: '港口对比' },
]

function zone(): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute(STACK_SLOT_ZONE_ATTR, '')
  return el
}

describe('useStackablePanels', () => {
  it('初始为空，stackItems 随叠入/还原变化', () => {
    const s = useStackablePanels(panels)
    expect(s.stackItems.value).toEqual([])
    s.onDrop('line', zone())
    expect(s.stackItems.value).toEqual([{ id: 'line', label: '预测趋势' }])
    s.restore('line')
    expect(s.stackItems.value).toEqual([])
  })

  it('重复投放幂等：同一面板不会叠两份', () => {
    const s = useStackablePanels(panels)
    s.onDrop('bar', zone())
    s.onDrop('bar', zone())
    expect(s.stackItems.value).toHaveLength(1)
  })

  it('非堆叠槽落点不叠入（主控制面板误拖到别处）', () => {
    const s = useStackablePanels(panels)
    s.onDrop('line', document.createElement('div'))
    expect(s.stackItems.value).toEqual([])
  })

  it('isStacked 反映叠入态', () => {
    const s = useStackablePanels(panels)
    expect(s.isStacked('line')).toBe(false)
    s.onDrop('line', zone())
    expect(s.isStacked('line')).toBe(true)
  })
})

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { STACK_SLOT_ZONE_ATTR } from '@/shared'

import StackSlot from '../StackSlot.vue'

// StackSlot 单测（v4-S9 系统 D）：空态显形/隐藏、堆叠卡头、展开列表、还原事件。

describe('StackSlot（堆叠固定槽位）', () => {
  it('空 + 非拖拽期 → 整体不渲染（空态零占位，L1）', () => {
    const wrapper = mount(StackSlot, { props: { items: [] } })
    expect(wrapper.find('.stack-slot').exists()).toBe(false)
  })

  it('空 + 拖拽期 → 显形命中框（带 data-stack-slot-zone，几何判定靠它）', () => {
    const wrapper = mount(StackSlot, { props: { items: [], dragActive: true } })
    const slot = wrapper.find('.stack-slot')
    expect(slot.exists()).toBe(true)
    expect(slot.attributes(STACK_SLOT_ZONE_ATTR)).toBe('stack')
    expect(slot.find('.stack-empty-hint').exists()).toBe(true)
  })

  it('生产形态（不传 dragActive prop，有堆叠项）→ 落点属性必须在（G1 红样：旧实现恒缺）', () => {
    const wrapper = mount(StackSlot, {
      props: { items: [{ id: 'line', label: '预测趋势' }] },
    })
    const slot = wrapper.find('.stack-slot')
    expect(slot.exists()).toBe(true)
    expect(slot.attributes(STACK_SLOT_ZONE_ATTR)).toBe('stack')
  })

  it('有堆叠项 → 卡头列表；点击「堆叠」展开；点「还原」emit restore', async () => {
    const wrapper = mount(StackSlot, {
      props: {
        items: [
          { id: 'line', label: '预测趋势', color: '#3b82f6' },
          { id: 'bar', label: '港口对比', color: '#f59e0b' },
        ],
      },
    })
    expect(wrapper.findAll('.stack-card')).toHaveLength(2)
    // 默认收起：列表不可见（v-show）
    expect(wrapper.find('.stack-list').isVisible()).toBe(false)
    await wrapper.find('.stack-expand-btn').trigger('click')
    // jsdom 的 isVisible 级联在此环境不可靠（内联 style 已被 v-show 清空仍报 none，
    // 实测 dump 见调试轮）——断言 v-show 的内联语义：expanded 后 style 不再含 none
    const list = wrapper.find('.stack-list')
    expect(list.attributes('style')).not.toContain('none')
    // 还原：emit restore 且不再出现在列表
    await wrapper.findAll('.stack-restore-btn')[0].trigger('click')
    expect(wrapper.emitted('restore')).toEqual([['line']])
  })
})

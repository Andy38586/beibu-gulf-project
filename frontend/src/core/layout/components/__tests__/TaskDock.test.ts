import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TaskDock, { type TaskDockCard } from '../TaskDock.vue'

// TaskDock 单测（v4-S5 可见层）：空态不渲染、卡片排序（活跃在前）、点击回路由。

const running: TaskDockCard = {
  taskId: 't1',
  route: '/flood-analysis',
  label: '淹没分析',
  icon: '🌊',
  status: 'running',
  progress: 0.4,
}

const done: TaskDockCard = {
  taskId: 't2',
  route: '/forecast',
  label: '预测趋势',
  icon: '📈',
  status: 'done',
  progress: 1,
}

describe('TaskDock（后台任务卡片条）', () => {
  it('空 → 整体不渲染（空态零占位，L1）', () => {
    const wrapper = mount(TaskDock, { props: { cards: [] } })
    expect(wrapper.find('.task-dock').exists()).toBe(false)
  })

  it('有卡片 → 渲染卡片；活跃任务带迷你进度环，终态带状态点', () => {
    const wrapper = mount(TaskDock, { props: { cards: [running, done] } })
    const cards = wrapper.findAll('.task-dock__card')
    expect(cards).toHaveLength(2)
    expect(wrapper.find('.task-dock__ring').exists()).toBe(true)
    expect(wrapper.find('.task-dock__dot.dot-done').exists()).toBe(true)
  })

  it('活跃任务排在前（运行中 → 已完成）', () => {
    const wrapper = mount(TaskDock, { props: { cards: [done, running] } })
    const labels = wrapper.findAll('.task-dock__label').map((n) => n.text())
    expect(labels).toEqual(['淹没分析', '预测趋势'])
  })

  it('点击卡片 → emit open 并携带路由（回面板语义）', async () => {
    const wrapper = mount(TaskDock, { props: { cards: [done] } })
    await wrapper.find('.task-dock__card').trigger('click')
    expect(wrapper.emitted('open')).toEqual([['/forecast']])
  })
})

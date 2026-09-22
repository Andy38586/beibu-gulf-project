import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import NavButton from '../components/NavButton.vue'
import {
  EMPTY_TASK_INDICATOR,
  getTaskIndicator,
  notifyTaskIndicator,
  registerTaskIndicator,
  taskIndicatorVersion,
} from '../taskIndicator'

/**
 * taskIndicator 单测（v4-S6）
 * 守住分层解法：core 不 import stores，而是消费根入口注入的**纯函数**。
 */

describe('taskIndicator', () => {
  it('未注入时返回空态（core 首次渲染不依赖任何注入方）', () => {
    expect(getTaskIndicator('/any')).toEqual(EMPTY_TASK_INDICATOR)
  })

  it('注入后按路由取值', () => {
    registerTaskIndicator((route) =>
      route === '/flood-analysis'
        ? { active: true, occupied: true, status: 'running', progress: 0.1 }
        : EMPTY_TASK_INDICATOR
    )

    expect(getTaskIndicator('/flood-analysis').active).toBe(true)
    expect(getTaskIndicator('/forecast').active).toBe(false)
  })

  it('registerTaskIndicator 递增版本号（core 侧据此重算）', () => {
    const before = taskIndicatorVersion.value
    registerTaskIndicator(() => EMPTY_TASK_INDICATOR)
    expect(taskIndicatorVersion.value).toBe(before + 1)
  })

  it('notifyTaskIndicator 递增版本号（数据变化通知通道）', () => {
    const before = taskIndicatorVersion.value
    notifyTaskIndicator()
    expect(taskIndicatorVersion.value).toBe(before + 1)
  })
})

describe('NavButton 进度环', () => {
  it('🔴 不传 taskRoute ⇒ 无环、无额外 DOM（现有消费方零变化，L1）', () => {
    const wrapper = mount(NavButton, { props: { label: '首页', icon: '⌂' } })
    expect(wrapper.find('.nav-button-ring').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'TaskProgressRing' }).exists()).toBe(false)
  })

  it('传 taskRoute 但无活跃任务 ⇒ 不显示环', () => {
    registerTaskIndicator(() => EMPTY_TASK_INDICATOR)
    const wrapper = mount(NavButton, { props: { label: '预测', taskRoute: '/forecast' } })
    expect(wrapper.find('.nav-button-ring').exists()).toBe(false)
  })

  it('传 taskRoute 且有活跃任务 ⇒ 显示环', async () => {
    registerTaskIndicator((route) =>
      route === '/flood-analysis'
        ? { active: true, occupied: true, status: 'running', progress: 0.1 }
        : EMPTY_TASK_INDICATOR
    )

    const wrapper = mount(NavButton, { props: { label: '浸没', taskRoute: '/flood-analysis' } })
    await nextTick()
    expect(wrapper.find('.nav-button-ring').exists()).toBe(true)
  })

  it('环挂在外层 wrap 内（绝对定位不改变按钮尺寸）', () => {
    registerTaskIndicator(() => ({
      active: true,
      occupied: true,
      status: 'running',
      progress: 0.5,
    }))

    const wrapper = mount(NavButton, { props: { label: 'X', taskRoute: '/x' } })
    const wrap = wrapper.find('.nav-button-wrap')
    expect(wrap.exists()).toBe(true)
    // 按钮仍是 wrap 的直接子元素，环是同层兄弟（不参与按钮内部布局）
    expect(wrap.find('.GCS-button').exists()).toBe(true)
    expect(wrap.find('.nav-button-ring').exists()).toBe(true)
  })
})

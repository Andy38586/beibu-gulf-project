import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NavButton from '../components/NavButton.vue'
import { registerRouteReadiness } from '../routeReadiness'
import { registerTaskIndicator } from '../taskIndicator'

// 接线断言（协议 7.1）：只有纯函数用例、没有接线断言 = 未完成。
// 这里证明「准备中」真的点亮了 NavButton 上那个环，且与任务语义不打架。

const ROUTE = '/flood-analysis'

function mountWith(state: { occupied: boolean; preparing: boolean }) {
  registerTaskIndicator(() =>
    state.occupied
      ? { active: false, occupied: true, status: 'done', progress: 1 }
      : { active: false, occupied: false, status: null, progress: 0 }
  )
  registerRouteReadiness(() => ({ preparing: state.preparing }))
  return mount(NavButton, { props: { label: '浸没', icon: '🌊', taskRoute: ROUTE } })
}

describe('NavButton 进度环：任务 与 页面准备 两个来源', () => {
  it('两者都没有 ⇒ 不画环（零打扰）', () => {
    const w = mountWith({ occupied: false, preparing: false })
    expect(w.find('.task-progress-ring').exists()).toBe(false)
  })

  it('🔴 只有页面准备中 ⇒ 画环，且是**不定进度**（无进度弧、轨道着主色）', () => {
    const w = mountWith({ occupied: false, preparing: true })
    expect(w.find('.task-progress-ring').exists()).toBe(true)
    expect(w.find('.task-progress-ring__bar').exists()).toBe(false)
    expect(w.find('.task-progress-ring__track').classes()).toContain(
      'task-progress-ring__track--active'
    )
    expect(w.find('.task-progress-ring').attributes('aria-label')).toBe('页面准备中')
  })

  it('只有任务 ⇒ 画环，且仍是任务语义（有进度弧、不是不定进度）', () => {
    const w = mountWith({ occupied: true, preparing: false })
    expect(w.find('.task-progress-ring__bar').exists()).toBe(true)
    expect(w.find('.task-progress-ring__track').classes()).not.toContain(
      'task-progress-ring__track--active'
    )
  })

  it('🔴 任务 + 准备同时成立 ⇒ 任务语义优先（不把有进度的任务降级成不定进度）', () => {
    const w = mountWith({ occupied: true, preparing: true })
    expect(w.find('.task-progress-ring__bar').exists()).toBe(true)
    expect(w.find('.task-progress-ring').attributes('aria-label')).toContain('任务进行中')
  })

  it('没有 taskRoute（如菜单键）⇒ 永不画环', () => {
    registerTaskIndicator(() => ({
      active: true,
      occupied: true,
      status: 'running',
      progress: 0.1,
    }))
    registerRouteReadiness(() => ({ preparing: true }))
    const w = mount(NavButton, { props: { label: '菜单', icon: '☰' } })
    expect(w.find('.task-progress-ring').exists()).toBe(false)
  })
})

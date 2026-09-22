import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TaskProgressRing from '../components/TaskProgressRing.vue'

/**
 * TaskProgressRing 单测（v4-S6）
 * 重点守住口径 #4 的三个硬参数：线宽恒为 3、dasharray = 2π×19、起点 -90°。
 */

/** 2π × 19 —— 与组件内 RADIUS 保持一致 */
const CIRCUMFERENCE = 2 * Math.PI * 19

describe('TaskProgressRing', () => {
  it('🔴 stroke-width 恒为 3（不随进度变化 —— 线宽动画会让环"跳动"）', () => {
    for (const progress of [0, 0.1, 0.5, 1]) {
      const wrapper = mount(TaskProgressRing, { props: { progress, status: 'running' } })
      const bars = wrapper.findAll('.task-progress-ring__bar')
      expect(bars.length).toBe(1)
      expect(bars[0]!.attributes('stroke-width')).toBe('3')
    }
  })

  it('轨道环与进度环线宽一致（都是 3）', () => {
    const wrapper = mount(TaskProgressRing, { props: { progress: 0.5, status: 'running' } })
    expect(wrapper.find('.task-progress-ring__track').attributes('stroke-width')).toBe('3')
    expect(wrapper.find('.task-progress-ring__bar').attributes('stroke-width')).toBe('3')
  })

  it('stroke-dasharray = 2π×19 ≈ 119.38（固定周长）', () => {
    const wrapper = mount(TaskProgressRing, { props: { progress: 0.4, status: 'running' } })
    const value = Number(wrapper.find('.task-progress-ring__bar').attributes('stroke-dasharray'))
    expect(value).toBeCloseTo(CIRCUMFERENCE, 2)
    expect(value).toBeCloseTo(119.38, 2)
  })

  it('dashoffset = 周长 ×(1 − p)：p=0 时满偏移（环不可见）', () => {
    const wrapper = mount(TaskProgressRing, { props: { progress: 0, status: 'running' } })
    const offset = Number(wrapper.find('.task-progress-ring__bar').attributes('stroke-dashoffset'))
    expect(offset).toBeCloseTo(CIRCUMFERENCE, 2)
  })

  it('dashoffset：p=1 时偏移为 0（环画满）', () => {
    const wrapper = mount(TaskProgressRing, { props: { progress: 1, status: 'done' } })
    const offset = Number(wrapper.find('.task-progress-ring__bar').attributes('stroke-dashoffset'))
    expect(offset).toBeCloseTo(0, 5)
  })

  it('dashoffset：p=0.5 时偏移为周长一半', () => {
    const wrapper = mount(TaskProgressRing, { props: { progress: 0.5, status: 'running' } })
    const offset = Number(wrapper.find('.task-progress-ring__bar').attributes('stroke-dashoffset'))
    expect(offset).toBeCloseTo(CIRCUMFERENCE / 2, 2)
  })

  it('进度越界被夹到 [0,1]（后端给脏值也不画出诡异环）', () => {
    const over = mount(TaskProgressRing, { props: { progress: 1.7, status: 'running' } })
    expect(
      Number(over.find('.task-progress-ring__bar').attributes('stroke-dashoffset'))
    ).toBeCloseTo(0, 5)

    const under = mount(TaskProgressRing, { props: { progress: -0.5, status: 'running' } })
    expect(
      Number(under.find('.task-progress-ring__bar').attributes('stroke-dashoffset'))
    ).toBeCloseTo(CIRCUMFERENCE, 2)
  })

  it('起点 rotate(-90 22 22)：从 12 点方向开始', () => {
    const wrapper = mount(TaskProgressRing, { props: { progress: 0.3 } })
    expect(wrapper.find('.task-progress-ring__bar').attributes('transform')).toBe(
      'rotate(-90 22 22)'
    )
  })

  it('五态颜色：活跃蓝 / 成功绿 / 失败红（消费既有 token）', () => {
    const primary = 'var(--GCS-color-primary)'
    const success = 'var(--GCS-color-success)'
    const danger = 'var(--GCS-color-danger)'

    const at = (status: 'pending' | 'running' | 'retrying' | 'done' | 'failed') =>
      mount(TaskProgressRing, { props: { status, progress: 0.5 } })
        .find('.task-progress-ring__bar')
        .attributes('stroke')

    expect(at('pending')).toBe(primary)
    expect(at('running')).toBe(primary)
    expect(at('retrying')).toBe(primary)
    expect(at('done')).toBe(success)
    expect(at('failed')).toBe(danger)
  })

  it('活跃态带呼吸 class（透明度过渐变），终态静止', () => {
    expect(
      mount(TaskProgressRing, { props: { status: 'running' } })
        .find('.task-progress-ring')
        .classes()
    ).toContain('is-breathing')

    expect(
      mount(TaskProgressRing, { props: { status: 'done' } })
        .find('.task-progress-ring')
        .classes()
    ).not.toContain('is-breathing')

    expect(
      mount(TaskProgressRing, { props: { status: 'failed' } })
        .find('.task-progress-ring')
        .classes()
    ).not.toContain('is-breathing')
  })

  it('size prop 驱动宽高，但不影响 viewBox/线宽（几何恒定）', () => {
    const wrapper = mount(TaskProgressRing, { props: { size: 18, progress: 0.5 } })
    const svg = wrapper.find('.task-progress-ring')
    expect(svg.attributes('viewBox')).toBe('0 0 44 44')
    expect(svg.attributes('style')).toContain('18px')
  })
})

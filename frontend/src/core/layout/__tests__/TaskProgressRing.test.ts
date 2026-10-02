import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TaskProgressRing from '../components/TaskProgressRing.vue'

/**
 * TaskProgressRing 单测（v4-S6）
 *
 * 守住口径 #4 的硬参数：线宽恒为 3、周长经 `pathLength` 归一化、圆角缩放后恒为 12px
 * （环 rx 与按钮 rx 是两套口径，见下方该用例的注释）。
 */

/** 周长经 `pathLength="100"` 归一化 —— 与组件内 dasharray 保持一致 */
const NORMALIZED_LENGTH = 100

describe('TaskProgressRing', () => {
  it('🔴 stroke-width 恒为 3（不随进度变化 —— 线宽动画会让框"跳动"）', () => {
    for (const progress of [0, 0.1, 0.5, 1]) {
      const wrapper = mount(TaskProgressRing, { props: { progress, status: 'running' } })
      const bars = wrapper.findAll('.task-progress-ring__bar')
      expect(bars.length).toBe(1)
      expect(bars[0]!.attributes('stroke-width')).toBe('3')
    }
  })

  it('轨道框与进度框线宽一致（都是 3）', () => {
    const wrapper = mount(TaskProgressRing, { props: { progress: 0.5, status: 'running' } })
    expect(wrapper.find('.task-progress-ring__track').attributes('stroke-width')).toBe('3')
    expect(wrapper.find('.task-progress-ring__bar').attributes('stroke-width')).toBe('3')
  })

  it('stroke-dasharray = 100（pathLength 归一化：换形状不必手算周长公式）', () => {
    const wrapper = mount(TaskProgressRing, { props: { progress: 0.4, status: 'running' } })
    const bar = wrapper.find('.task-progress-ring__bar')
    expect(bar.attributes('pathLength')).toBe('100')
    expect(bar.attributes('stroke-dasharray')).toBe('100')
  })

  it('dashoffset = 100 ×(1 − p)：p=0 时满偏移（框不可见）', () => {
    const wrapper = mount(TaskProgressRing, { props: { progress: 0, status: 'running' } })
    const offset = Number(wrapper.find('.task-progress-ring__bar').attributes('stroke-dashoffset'))
    expect(offset).toBeCloseTo(NORMALIZED_LENGTH, 5)
  })

  it('dashoffset：p=1 时偏移为 0（框画满）', () => {
    const wrapper = mount(TaskProgressRing, { props: { progress: 1, status: 'done' } })
    const offset = Number(wrapper.find('.task-progress-ring__bar').attributes('stroke-dashoffset'))
    expect(offset).toBeCloseTo(0, 5)
  })

  it('dashoffset：p=0.5 时偏移为一半', () => {
    const wrapper = mount(TaskProgressRing, { props: { progress: 0.5, status: 'running' } })
    const offset = Number(wrapper.find('.task-progress-ring__bar').attributes('stroke-dashoffset'))
    expect(offset).toBeCloseTo(NORMALIZED_LENGTH / 2, 5)
  })

  it('进度越界被夹到 [0,1]（后端给脏值也不画出诡异框）', () => {
    const over = mount(TaskProgressRing, { props: { progress: 1.7, status: 'running' } })
    expect(
      Number(over.find('.task-progress-ring__bar').attributes('stroke-dashoffset'))
    ).toBeCloseTo(0, 5)

    const under = mount(TaskProgressRing, { props: { progress: -0.5, status: 'running' } })
    expect(
      Number(under.find('.task-progress-ring__bar').attributes('stroke-dashoffset'))
    ).toBeCloseTo(NORMALIZED_LENGTH, 5)
  })

  it('🔴 形状是圆角矩形（rect，不是 circle）—— dock 按钮本身是带小圆角的方形，正圆环反而像外来件', () => {
    const wrapper = mount(TaskProgressRing, { props: { progress: 0.3 } })
    expect(wrapper.find('.task-progress-ring__bar').element.tagName.toLowerCase()).toBe('rect')
    expect(wrapper.find('.task-progress-ring__track').element.tagName.toLowerCase()).toBe('rect')
  })

  // 不定进度（2026-10-02，Cesium ②）：形态零变化，只是"这一圈在动"而不是"走了百分之几"。
  it('🔴 indeterminate：不画进度弧（不伪造百分比）、轨道着主色、aria 说"页面准备中"、恒呼吸', () => {
    const wrapper = mount(TaskProgressRing, { props: { indeterminate: true } })
    expect(wrapper.find('.task-progress-ring__bar').exists()).toBe(false)
    expect(wrapper.find('.task-progress-ring__track').classes()).toContain(
      'task-progress-ring__track--active'
    )
    expect(wrapper.attributes('aria-label')).toBe('页面准备中')
    expect(wrapper.classes()).toContain('is-breathing')
  })

  /**
   * 环 rx 与按钮 rx 是**两套口径**（04-H1）：
   *   · 按钮 rx = `cellPixel × 0.15`（`GCSButton.vue` 的 `buttonStyle`，随档位 70/80/90 变）；
   *   · 环 rx  = 恒定 12px，不随 size、也不随 cellPixel 变（组件不读 `useGCS`）。
   *
   * 这组断言钉的是"恒定"那一侧：把反算摘掉（viewBox 写死 12 ⇒ 渲染随 size 放大）或改成
   * 从 cellPixel 派生（jsdom 下 70 ⇒ 渲染 10.5px），三档里至少一档必红。
   */
  it('🔴 圆角反算后恒为 12px（刻意选定的常量，不是按钮 token）—— 与按钮 rx 两套口径', () => {
    // dock 实际传入的三档：NavButton 的 ringSize = round(cellPixel × 0.8 + 8)，cell 70/80/90
    for (const size of [64, 72, 80]) {
      const wrapper = mount(TaskProgressRing, { props: { progress: 0.3, size } })
      const rx = Number(wrapper.find('.task-progress-ring__bar').attributes('rx'))
      expect(rx * (size / 44), `size=${size} 时渲染圆角应仍是 12px`).toBeCloseTo(12, 5)
    }

    // 反算本身：viewBox 坐标与 size 成反比（不反算就会随 size 放大）
    const at44 = mount(TaskProgressRing, { props: { progress: 0.3, size: 44 } })
    expect(Number(at44.find('.task-progress-ring__bar').attributes('rx'))).toBeCloseTo(12, 5)

    const at88 = mount(TaskProgressRing, { props: { progress: 0.3, size: 88 } })
    // rx = 12 × 44 / 88 = 6（viewBox 坐标）⇒ 缩放因子 88/44 = 2 ⇒ 实际 12px
    const rx = Number(at88.find('.task-progress-ring__bar').attributes('rx'))
    expect(rx).toBeCloseTo(6, 5)
    expect(rx * (88 / 44)).toBeCloseTo(12, 5)
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

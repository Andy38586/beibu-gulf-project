// DebugToggle 点击链路回归测试（2026-08-09：排查"调试模式调不出来"）
// 注意：DebugToggle 根是 Teleport，内容渲染到 document.body，须从 body 查询/触发
import { mount } from '@vue/test-utils'
import { beforeEach,describe, expect, it, vi } from 'vitest'

import DebugToggle from '../components/DebugToggle.vue'

function bodyButton(): HTMLButtonElement | null {
  return document.body.querySelector<HTMLButtonElement>('.debug-toggle')
}

describe('DebugToggle', () => {
  beforeEach(() => {
    vi.resetModules()
    document.body.innerHTML = ''
  })

  it('Teleport 到 body：按钮应出现在 document.body 下', async () => {
    mount(DebugToggle, { props: { modelValue: false } })
    await new Promise((r) => setTimeout(r, 0))
    expect(bodyButton()).not.toBeNull()
  })

  it('点击按钮应 emit update:modelValue=true（v-model 链路，2026-08-09 修复）', async () => {
    const wrapper = mount(DebugToggle, { props: { modelValue: false } })
    await new Promise((r) => setTimeout(r, 0))
    const btn = bodyButton()
    expect(btn).not.toBeNull()
    btn!.click()
    const events = wrapper.emitted('update:modelValue')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual([true])
  })

  it('modelValue=true 时点击应 emit false（toggle 语义）', async () => {
    const wrapper = mount(DebugToggle, { props: { modelValue: true } })
    await new Promise((r) => setTimeout(r, 0))
    bodyButton()!.click()
    const events = wrapper.emitted('update:modelValue')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual([false])
  })
})

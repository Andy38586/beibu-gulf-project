// @vitest-environment jsdom
/**
 * GCSModal 主按钮回调契约测试
 *
 * 回归守卫（2026-09-10 修复）：login 模式此前绕过 confirmModal() 自行
 * closeModal() + router.push('/profile')，把 errorHandler.ts:92 注入的 onConfirm
 * （携带 `?redirect=` 原页面路径）整个丢弃 —— 被 401 打断的操作在登录后永远回不到
 * 原页面，ProfilePage 的 redirect 消费逻辑成为死代码。
 */
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPush = vi.hoisted(() => vi.fn())
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useRoute: () => ({ query: {} }),
}))

import { gcsModalState, showModal } from '@/shared/utils/gcsFeedback'

import GCSModal from '../GCSModal.vue'

/** 打开一个指定模式的弹窗（复用真实 showModal，保证状态机语义一致） */
function openModal(mode: 'login' | 'confirm' | 'error', onConfirm?: () => void): void {
  showModal({
    message: '测试提示',
    mode,
    ...(onConfirm ? { onConfirm } : {}),
  })
}

/** 触发主按钮（模板里唯一带 .GCS-btn-primary 类的按钮） */
async function clickPrimary(wrapper: ReturnType<typeof mount>): Promise<void> {
  await nextTick() // 等 showModal 置 visible 后的首次渲染
  const btn = wrapper.find('.GCS-btn-primary')
  expect(btn.exists()).toBe(true)
  await btn.trigger('click')
}

describe('GCSModal 主按钮回调', () => {
  beforeEach(() => {
    mockPush.mockReset()
  })

  afterEach(() => {
    document.body.innerHTML = ''
    gcsModalState.visible = false
    gcsModalState.onConfirm = null
  })

  it('login 模式：执行注入的 onConfirm（redirect 链路不再被丢弃）', async () => {
    const wrapper = mount(GCSModal)
    const onConfirm = vi.fn()
    openModal('login', onConfirm)

    await clickPrimary(wrapper)

    expect(onConfirm).toHaveBeenCalledTimes(1)
    // 未走默认跳转分支
    expect(mockPush).not.toHaveBeenCalledWith('/profile')
    expect(gcsModalState.visible).toBe(false)
  })

  it('login 模式且未注入 onConfirm：回退默认跳转个人中心', async () => {
    const wrapper = mount(GCSModal)
    openModal('login')

    await clickPrimary(wrapper)

    expect(mockPush).toHaveBeenCalledWith('/profile')
  })

  it('confirm 模式：走 confirmModal 执行 onConfirm', async () => {
    const wrapper = mount(GCSModal)
    const onConfirm = vi.fn()
    openModal('confirm', onConfirm)

    await clickPrimary(wrapper)

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(mockPush).not.toHaveBeenCalled()
  })
})

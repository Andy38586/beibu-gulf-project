// @vitest-environment jsdom
/**
 * LoginPanel 反馈契约单测：
 * ① 错误反馈一律走全局 toast（GCS 反馈层），组件内不再有内联错误节点；
 * ② 文案按 ApiError 错误码区分真实成因——后端不可达→「服务器无响应」，
 *    密码错误→透传后端「用户名或密码错误」，均不再说「请先登录」；
 * ③ 注册模式密码 placeholder 携带格式提示（字母数字这类要求前置告知）。
 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogin = vi.fn()
const mockRegister = vi.fn()
vi.mock('@/shared/composables/useAuth', () => ({
  useAuth: () => ({ login: mockLogin, register: mockRegister }),
}))

import { ApiError, ErrorCode } from '@/shared/composables/useApiRequest'
import { gcsToastState } from '@/shared/utils/gcsFeedback'

import LoginPanel from '../LoginPanel.vue'

/** 填登录表单并提交 */
async function fillAndSubmit(
  wrapper: ReturnType<typeof mount>,
  username: string,
  password: string
) {
  await wrapper.find('input[type="text"]').setValue(username)
  await wrapper.find('input[type="password"]').setValue(password)
  await wrapper.find('button.submit-btn').trigger('click')
  await vi.dynamicImportSettled()
}

describe('LoginPanel 错误反馈（全局 toast 化）', () => {
  beforeEach(() => {
    mockLogin.mockReset()
    mockRegister.mockReset()
    gcsToastState.items.length = 0
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('空表单提交 → warning toast 提示，不发起请求，无内联错误节点', async () => {
    const wrapper = mount(LoginPanel)
    await wrapper.find('button.submit-btn').trigger('click')
    await vi.dynamicImportSettled()
    expect(gcsToastState.items[0]?.message).toBe('请填写用户名和密码')
    expect(gcsToastState.items[0]?.type).toBe('warning')
    expect(mockLogin).not.toHaveBeenCalled()
    // 内联错误渲染已移除（feedback 一律走 toast）
    expect(wrapper.find('.error-text').exists()).toBe(false)
  })

  it('登录 401 → toast 透传后端「用户名或密码错误」，不说「请先登录」', async () => {
    const wrapper = mount(LoginPanel)
    mockLogin.mockRejectedValue(new ApiError('用户名或密码错误', ErrorCode.UNAUTHORIZED))
    await fillAndSubmit(wrapper, 'tester', 'WrongPass1')
    expect(gcsToastState.items[0]?.message).toBe('用户名或密码错误')
    expect(gcsToastState.items[0]?.type).toBe('error')
    expect(gcsToastState.items.some((t) => t.message.includes('请先登录'))).toBe(false)
  })

  it('后端不可达（NETWORK_ERROR）→ toast「服务器无响应」，不往「登录」上引', async () => {
    const wrapper = mount(LoginPanel)
    mockLogin.mockRejectedValue(new ApiError('网络异常，请检查网络连接', ErrorCode.NETWORK_ERROR))
    await fillAndSubmit(wrapper, 'tester', 'AnyPass1')
    expect(gcsToastState.items[0]?.message).toBe('服务器无响应，请检查网络后重试')
    expect(gcsToastState.items[0]?.type).toBe('error')
  })

  it('注册弱密码 → warning toast 格式要求，不发起注册', async () => {
    const wrapper = mount(LoginPanel)
    // 切到注册模式；'abcdef' 满足长度但缺大小写字母和数字 → 命中强度校验
    await wrapper.findAll('.mode-btn')[1].trigger('click')
    await fillAndSubmit(wrapper, 'tester', 'abcdef')
    expect(gcsToastState.items[0]?.message).toBe('密码必须包含大小写字母和数字')
    expect(gcsToastState.items[0]?.type).toBe('warning')
    expect(mockRegister).not.toHaveBeenCalled()
  })

  it('注册模式密码 placeholder 携带格式提示', async () => {
    const wrapper = mount(LoginPanel)
    await wrapper.findAll('.mode-btn')[1].trigger('click')
    const placeholder = wrapper.find('input[type="password"]').attributes('placeholder')
    expect(placeholder).toContain('大小写字母')
    expect(placeholder).toContain('6')
  })
})

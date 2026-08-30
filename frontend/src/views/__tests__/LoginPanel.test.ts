// @vitest-environment jsdom
/**
 * LoginPanel 反馈契约单测：
 * ① 错误反馈一律走全局 toast（GCS 反馈层），组件内不再有内联错误节点；
 * ② 文案按成因逐条细分——空账号/空密码分开报；密码错误（401003）只报「密码错误」；
 *    账号不存在（401002）→「账号不存在，请先注册」并切注册模式保留账号；
 *    后端不可达→「服务器无响应」，均不再说「请先登录」；
 * ③ 注册模式密码 placeholder 携带格式提示（字母数字这类要求前置告知）。
 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogin = vi.hoisted(() => vi.fn())
const mockRegister = vi.hoisted(() => vi.fn())
vi.mock('@/shared/composables/useAuth', () => ({
  useAuth: () => ({ login: mockLogin, register: mockRegister }),
}))

import { ApiError, ErrorCode } from '@/shared/composables/useApiRequest'
import { gcsToastState } from '@/shared/utils/gcsFeedback'

import LoginPanel from '../LoginPanel.vue'

/** 后端登录业务码（与 LoginPanel/后端 ErrorCode 对齐） */
const AUTH_BIZ_CODE = { USER_NOT_FOUND: 401002, WRONG_PASSWORD: 401003 }

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

describe('LoginPanel 错误反馈（全局 toast 化 + 分语义）', () => {
  beforeEach(() => {
    mockLogin.mockReset()
    mockRegister.mockReset()
    gcsToastState.items.length = 0
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('账号为空 → 只报「请输入用户名」，不发起请求，无内联错误节点', async () => {
    const wrapper = mount(LoginPanel)
    await wrapper.find('input[type="password"]').setValue('AnyPass1')
    await wrapper.find('button.submit-btn').trigger('click')
    await vi.dynamicImportSettled()
    expect(gcsToastState.items[0]?.message).toBe('请输入用户名')
    expect(gcsToastState.items[0]?.type).toBe('warning')
    expect(mockLogin).not.toHaveBeenCalled()
    // 内联错误渲染已移除（feedback 一律走 toast）
    expect(wrapper.find('.error-text').exists()).toBe(false)
  })

  it('密码为空 → 只报「请输入密码」（与账号空分开提示，不合并）', async () => {
    const wrapper = mount(LoginPanel)
    await wrapper.find('input[type="text"]').setValue('tester')
    await wrapper.find('button.submit-btn').trigger('click')
    await vi.dynamicImportSettled()
    expect(gcsToastState.items[0]?.message).toBe('请输入密码')
    expect(gcsToastState.items[0]?.type).toBe('warning')
    expect(mockLogin).not.toHaveBeenCalled()
  })

  it('密码错误（401003）→ toast 透传后端「密码错误」，不说「请先登录」', async () => {
    const wrapper = mount(LoginPanel)
    mockLogin.mockRejectedValue(
      new ApiError('密码错误', ErrorCode.UNAUTHORIZED, AUTH_BIZ_CODE.WRONG_PASSWORD)
    )
    await fillAndSubmit(wrapper, 'tester', 'WrongPass1')
    expect(gcsToastState.items[0]?.message).toBe('密码错误')
    expect(gcsToastState.items[0]?.type).toBe('error')
    expect(gcsToastState.items.some((t) => t.message.includes('请先登录'))).toBe(false)
  })

  it('账号不存在（401002）→ 提示先注册，切到注册模式并保留已输账号', async () => {
    const wrapper = mount(LoginPanel)
    mockLogin.mockRejectedValue(
      new ApiError('账号不存在，请先注册', ErrorCode.UNAUTHORIZED, AUTH_BIZ_CODE.USER_NOT_FOUND)
    )
    await fillAndSubmit(wrapper, 'newuser', 'AnyPass1')
    expect(gcsToastState.items[0]?.message).toBe('账号不存在，请先注册')
    expect(gcsToastState.items[0]?.type).toBe('warning')
    // 注册模式激活：确认密码输入框出现
    expect(wrapper.findAll('input[type="password"]').length).toBe(2)
    // 账号保留、密码清空
    expect((wrapper.find('input[type="text"]').element as HTMLInputElement).value).toBe('newuser')
    expect((wrapper.findAll('input[type="password"]')[0].element as HTMLInputElement).value).toBe(
      ''
    )
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

  it('注册模式确认密码为空 → 报「请输入确认密码」（不误报「两次密码输入不一致」）', async () => {
    const wrapper = mount(LoginPanel)
    await wrapper.findAll('.mode-btn')[1].trigger('click')
    await wrapper.find('input[type="text"]').setValue('tester')
    const passwords = wrapper.findAll('input[type="password"]')
    await passwords[0].setValue('Abc12345') // 满足强度；确认密码留空
    await wrapper.find('button.submit-btn').trigger('click')
    await vi.dynamicImportSettled()
    expect(gcsToastState.items[0]?.message).toBe('请输入确认密码')
    expect(gcsToastState.items[0]?.type).toBe('warning')
    expect(gcsToastState.items.some((t) => t.message.includes('两次密码输入不一致'))).toBe(false)
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

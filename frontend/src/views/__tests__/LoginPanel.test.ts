// @vitest-environment jsdom
/**
 * LoginPanel 反馈契约单测：
 * ① 错误反馈一律走全局 toast（GCS 反馈层），组件内不再有内联错误节点；
 * ② 文案按成因逐条细分——空账号/空密码分开报；密码错误（401003）只报「密码错误」；
 *    账号不存在（401002）→「账号不存在，请先注册」并切注册模式保留账号；
 *    后端不可达→「服务器无响应」，均不再说「请先登录」；
 * ③ 注册模式密码 placeholder 携带格式提示（字母数字这类要求前置告知）；
 * ④ 09-11 双轨消除：用户名/密码的字符集与强度规则前端**不再保留副本**，
 *    权威判据在后端（auth.dto.ts 的 USERNAME_REGEX / PASSWORD_REGEX），
 *    前端只留「本端可判」的长度与两次一致。
 */
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
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

/** 切换模式后等一帧，确认密码输入框（v-if）才会被 patch 进 DOM */
async function toRegisterMode(wrapper: ReturnType<typeof mount>) {
  await wrapper.findAll('.mode-btn')[1].trigger('click')
  await nextTick()
}

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

  it('密码长度不足（<6）→ warning toast，不发起注册', async () => {
    const wrapper = mount(LoginPanel)
    // 切到注册模式；'Ab1' 长度不足 → 命中本端长度校验（长度是本端可判的，故保留在前端）
    await toRegisterMode(wrapper)
    await fillAndSubmit(wrapper, 'tester', 'Ab1')
    expect(gcsToastState.items[0]?.message).toBe('密码长度不能少于 6 位')
    expect(gcsToastState.items[0]?.type).toBe('warning')
    expect(mockRegister).not.toHaveBeenCalled()
  })

  it('注册模式确认密码为空 → 报「请输入确认密码」（不误报「两次密码输入不一致」）', async () => {
    const wrapper = mount(LoginPanel)
    await toRegisterMode(wrapper)
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
    await toRegisterMode(wrapper)
    const placeholder = wrapper.find('input[type="password"]').attributes('placeholder')
    expect(placeholder).toContain('大小写字母')
    expect(placeholder).toContain('6')
  })
})

describe('LoginPanel 用户名字符集校验归属（后端权威，前端不再有副本）', () => {
  beforeEach(() => {
    mockLogin.mockReset()
    mockRegister.mockReset()
    gcsToastState.items.length = 0
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  // 回归守卫：字符集校验曾位于 register 判断之前，登录复用注册规则；而后端
  // auth.dto 的 LoginBody 无字符集限制 ⇒ 含 `-`/`.` 的合法存量账号永远登不进。
  it('登录模式：含连字符的用户名不被字符集拦下，正常发起登录', async () => {
    const wrapper = mount(LoginPanel)
    await wrapper.find('input[type="text"]').setValue('old-user')
    await wrapper.find('input[type="password"]').setValue('AnyPass1')
    await wrapper.find('button.submit-btn').trigger('click')
    await vi.dynamicImportSettled()
    expect(gcsToastState.items.some((t) => t.message.includes('仅限中英文'))).toBe(false)
    expect(mockLogin).toHaveBeenCalledWith('old-user', 'AnyPass1')
  })

  // 09-11 双轨消除：注册模式的字符集校验已从前端删除（权威判据在 backend
  // `USERNAME_REGEX`，auth.dto.ts:19）。前端不再拦，请求直达后端 —— 由后端的
  // 400001 文案经 describeError 透传。本用例锁定「前端不再有该规则副本」。
  it('注册模式：含连字符的用户名前端不再拦，请求直达后端（规则副本已移除）', async () => {
    const wrapper = mount(LoginPanel)
    await toRegisterMode(wrapper)
    await wrapper.find('input[type="text"]').setValue('new-user')
    await wrapper.find('input[type="password"]').setValue('Abc12345')
    // 确认密码（register 分支的必填项，留空会在本端被拦、请求发不出去）
    await wrapper.findAll('input[type="password"]')[1].setValue('Abc12345')
    await wrapper.find('button.submit-btn').trigger('click')
    await vi.dynamicImportSettled()
    // 关键断言：前端不再产出「仅限中英文」文案（该判据只剩后端一份）
    expect(gcsToastState.items.some((t) => t.message.includes('仅限中英文'))).toBe(false)
    expect(mockRegister).toHaveBeenCalledWith('new-user', 'Abc12345')
  })

  // 反向守卫：后端可判的强度规则（大小写+数字）前端也不拦，交由后端 400001 文案回传。
  // 若前端将来又抄一份强度正则，此用例第一条断言会失败（会先出前端 warning）。
  it('注册模式：弱密码（满足长度但缺强度）前端不拦，透传后端错误文案', async () => {
    const wrapper = mount(LoginPanel)
    await toRegisterMode(wrapper)
    // 后端权威文案（auth.dto.ts PASSWORD_REGEX 分支）
    mockRegister.mockRejectedValue(
      new ApiError('密码必须包含大小写字母和数字', ErrorCode.REQUEST_FAILED)
    )
    await wrapper.find('input[type="text"]').setValue('tester')
    const passwords = wrapper.findAll('input[type="password"]')
    await passwords[0].setValue('abcdef') // 长度 ≥6 但缺强度 → 前端不再有该规则
    await passwords[1].setValue('abcdef') // 两次一致 → 本端校验全过，请求送达后端
    await wrapper.find('button.submit-btn').trigger('click')
    await vi.dynamicImportSettled()
    // 前端未拦（否则 mockRegister 不会被调用，且 toast 会是 warning 而非 error）
    expect(mockRegister).toHaveBeenCalledWith('tester', 'abcdef')
    expect(gcsToastState.items[0]?.message).toBe('密码必须包含大小写字母和数字')
    expect(gcsToastState.items[0]?.type).toBe('error')
  })
})

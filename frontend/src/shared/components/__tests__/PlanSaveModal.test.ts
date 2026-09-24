// @vitest-environment jsdom
/**
 * PlanSaveModal 的本地校验反馈测试（R2-13/08）
 *
 * 修前有两个形状不对的行为同时存在：
 *  ① 组件声明了 `error` 事件，但组件内**没有任何 emit('error') 站点**，而父级 PlansPanel
 *     绑了 `@error="(msg) => (saveError = msg)"` ⇒ 一条永不触发的事件通道 + 一个永不
 *     经它写入的父级状态。校验失败的真实通道是 `errorMsg` prop（后端 400001 回传）。
 *     本笔删除声明与绑定（删除本身即证据，不另立"不许再有死事件"的守卫）。
 *  ② `handleConfirm` 对空名 `return` 而不给任何反馈。确认按钮靠 `:disabled` 挡着，
 *     但表单 submit（输入框内回车）绕得过 disabled ⇒ 用户按回车后什么也没发生
 *     （04-D5：不许把恢复路径写成摆设）。
 *
 * 判别项只有 T1（修前红）。T2/T3 在修前后都绿，作用是**阳性对照**：证明 T1 的绿不是
 * 因为"提交被整个吞掉了"或"提示节点根本渲染不出来"。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PlanSaveModal from '../PlanSaveModal.vue'

/** el-* 的最小组合：够承载 v-model、#footer 插槽与原生 form 的 submit 冒泡 */
const ElDialog = { template: '<div><slot /><slot name="footer" /></div>' }
const ElForm = { template: '<form><slot /></form>' }
const ElInput = {
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template:
    '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
}
const ElButton = {
  props: ['disabled', 'loading', 'type', 'size'],
  template: '<button :disabled="disabled"><slot /></button>',
}

function mountModal(props: Record<string, unknown> = {}) {
  return mount(PlanSaveModal, {
    props: { visible: true, saving: false, errorMsg: '', initialName: '', ...props },
    global: { components: { ElDialog, ElForm, ElInput, ElButton } },
  })
}

describe('PlanSaveModal 空名反馈与提交契约', () => {
  it('🔴 空名回车：给出就地提示且不 emit save（修前红——静默早退）', async () => {
    const wrapper = mountModal()

    await wrapper.find('form').trigger('submit')

    expect(wrapper.find('.modal-error').exists()).toBe(true)
    expect(wrapper.find('.modal-error').text()).toContain('请输入方案名称')
    expect(wrapper.emitted('save')).toBeUndefined()
  })

  it('阳性对照：合法名回车必须 emit save(去空格后的名字)，且提示消失', async () => {
    const wrapper = mountModal()

    await wrapper.find('input').setValue('  台风路径方案  ')
    await wrapper.find('form').trigger('submit')

    expect(wrapper.emitted('save')).toEqual([['台风路径方案']])
    expect(wrapper.find('.modal-error').exists()).toBe(false)
  })

  it('阳性对照：errorMsg（后端校验失败通道）照常渲染，未被本地提示挤掉', async () => {
    const wrapper = mountModal({ errorMsg: '方案名称只能包含中文、字母、数字与下划线' })

    expect(wrapper.find('.modal-error').text()).toContain('方案名称只能包含中文')
  })

  it('确认按钮对空名保持 disabled：回车路径是唯一的旁路，故 T1 必须报提示', () => {
    const wrapper = mountModal()
    const buttons = wrapper.findAll('button')
    const confirm = buttons[buttons.length - 1]

    expect(confirm?.attributes('disabled')).toBeDefined()
  })
})

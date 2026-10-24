import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import GCSPanel from '../GCSPanel.vue'

// GCSPanel title 面板头单测（DiversionPage 年份头提取为组件级 token）：
// 传 title 时渲染 .GCS-panel__header 且文本正确；不传 title 时不渲染该节点。
// 挂载方式参照同目录 GCSPanel.compact.test.ts（w/h 必填）。

describe('GCSPanel title 面板头', () => {
  it('传 title="年份"：渲染 .GCS-panel__header 且文本为「年份」', () => {
    const wrapper = mount(GCSPanel, { props: { w: 4, h: 4, title: '年份' } })
    const header = wrapper.find('.GCS-panel__header')
    expect(header.exists()).toBe(true)
    expect(header.text()).toBe('年份')
  })

  it('不传 title：不渲染 .GCS-panel__header 节点', () => {
    const wrapper = mount(GCSPanel, { props: { w: 4, h: 4 } })
    expect(wrapper.find('.GCS-panel__header').exists()).toBe(false)
  })
})

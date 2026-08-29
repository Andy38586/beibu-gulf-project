// @vitest-environment jsdom
/**
 * MapFeatureBubble 要素气泡单测：
 * 港口字段渲染 + 缺失可选字段回退「暂无」+ 钉住态关闭按钮（悬浮态无）。
 * 锚点定位/随地图跟随由 OLRenderer 的 Overlay 承担，不在本组件职责内。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { Port } from '@/types'

import MapFeatureBubble from '../components/MapFeatureBubble.vue'

const port: Port = {
  id: '1',
  name: '钦州港',
  lng: 108.62,
  lat: 21.7,
  type: 'container',
  address: '广西钦州市',
  phone: '0777-1234567',
}

describe('MapFeatureBubble（要素气泡）', () => {
  it('渲染港口名称/地址/电话/坐标；悬浮态（非钉住）无关闭按钮', () => {
    const wrapper = mount(MapFeatureBubble, { props: { port, pinned: false } })
    const text = wrapper.text()
    expect(text).toContain('钦州港')
    expect(text).toContain('广西钦州市')
    expect(text).toContain('0777-1234567')
    expect(text).toContain('108.6200')
    expect(wrapper.find('.bubble-close').exists()).toBe(false)
  })

  it('钉住态显示关闭按钮，点击 emit close', async () => {
    const wrapper = mount(MapFeatureBubble, { props: { port, pinned: true } })
    expect(wrapper.find('.bubble-close').exists()).toBe(true)
    await wrapper.find('.bubble-close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('缺失可选字段回退「暂无」，坐标保留 4 位小数', () => {
    const wrapper = mount(MapFeatureBubble, {
      props: { port: { id: '2', name: '北海港', lng: 1.2, lat: 3.4, address: '', phone: '' } },
    })
    const text = wrapper.text()
    expect(text).toContain('暂无')
    expect(text).toContain('1.2000, 3.4000')
  })
})

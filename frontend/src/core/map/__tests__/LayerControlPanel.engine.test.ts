import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BusinessLayerManager } from '@/core/map/BusinessLayerManager'
import { BUSINESS_LAYER_MANAGER_KEY } from '@/core/map/composables/useBusinessLayers'
import { useMapStore } from '@/stores'
import type { MapRenderer } from '@/types'

import LayerControlPanel from '../components/LayerControlPanel.vue'

// W6（a035）判据：面板三态。
// 旧形态只有 on/off 两态 ⇒ 单引擎特化图层在**另一引擎**下照样可点亮，点了什么也不会发生
//（BLM.reapplyAll 会按引擎跳过创建）。本件断言：不适用的条目必须 disabled + unsupported 态，
// 且引擎切回后恢复可点（两态都要断言，避免"恒灰"也能过）。
function mountPanel() {
  return mount(LayerControlPanel)
}

describe('LayerControlPanel 引擎三态', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('🔴 单引擎图层在另一引擎下不可点亮，切回适用引擎后恢复', async () => {
    const mapStore = useMapStore()
    // 3D（Cesium）当前引擎：openlayers-only 图层不适用
    mapStore.setCurrentRenderer({ getType: () => '3d' } as unknown as MapRenderer)
    mapStore.registerBusinessLayer('ol-only', '二维专用', 'heatmap', false, ['openlayers'])
    mapStore.registerBusinessLayer('both', '双引擎通用', 'points', false, ['openlayers', 'cesium'])

    const wrapper = mountPanel()
    const olBtn = wrapper.findAll('.layer-btn').find((b) => b.text().includes('二维专用'))
    const bothBtn = wrapper.findAll('.layer-btn').find((b) => b.text().includes('双引擎通用'))

    expect(olBtn?.attributes('disabled')).toBeDefined()
    expect(olBtn?.classes()).toContain('unsupported')
    expect(olBtn?.attributes('title')).toContain('当前引擎不支持')
    expect(bothBtn?.attributes('disabled')).toBeUndefined()

    // 切到 2D（OpenLayers）：该条目恢复可点（避免"无条件置灰"也能过）
    mapStore.setCurrentRenderer({ getType: () => '2d' } as unknown as MapRenderer)
    await wrapper.vm.$nextTick()
    const olBtn2d = wrapper.findAll('.layer-btn').find((b) => b.text().includes('二维专用'))
    expect(olBtn2d?.attributes('disabled')).toBeUndefined()
    expect(olBtn2d?.classes()).not.toContain('unsupported')
  })

  it('渲染器未就绪（currentEngineName=null）不下"不支持"结论：按钮不因引擎判定置灰', () => {
    const mapStore = useMapStore()
    mapStore.setCurrentRenderer(null)
    mapStore.registerBusinessLayer('ol-only', '二维专用', 'heatmap', false, ['openlayers'])

    const wrapper = mountPanel()
    const btn = wrapper.findAll('.layer-btn').find((b) => b.text().includes('二维专用'))
    expect(btn?.attributes('disabled')).toBeUndefined()
  })
})

// a029 判据：面板四态里的 not-mounted —— 开关想显示但 BLM 重绘后没上屏（data 未就绪）。
// 旧形态只有 on/off：按钮是蓝的，屏幕上没有，用户以为是自己看错。
describe('LayerControlPanel 未上屏四态（a029）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('🔴 想显示却没上屏 ⇒ 标灰提示且保持可点；数据到位后恢复常规态', async () => {
    const mapStore = useMapStore()
    const renderer = {
      getType: () => '2d',
      addPointLayer: vi.fn(),
      hasLayer: vi.fn().mockReturnValue(false),
      setVisibility: vi.fn(),
    }
    mapStore.setCurrentRenderer(renderer as unknown as MapRenderer)
    // 真实 BLM（非 no-op 桩）：标记由 register/reapplyAll 写入
    const manager = new BusinessLayerManager(mapStore)
    manager.register('lazy', {
      label: '预测图层',
      layerType: 'points',
      data: null,
      visible: true,
    })

    const wrapper = mount(LayerControlPanel, {
      global: { provide: { [BUSINESS_LAYER_MANAGER_KEY]: manager } },
    })
    const findBtn = () => wrapper.findAll('.layer-btn').find((b) => b.text().includes('预测图层'))

    expect(findBtn()?.classes()).toContain('not-mounted')
    expect(findBtn()?.attributes('title')).toContain('数据未就绪')
    // 不能 disabled：点一次是"关掉它"，把出路一并堵死等于换个地方坑用户
    expect(findBtn()?.attributes('disabled')).toBeUndefined()

    // 数据到位 → 补建成功 → 撤销标灰（避免"无条件标灰"也能过）
    manager.updateData('lazy', { data: [{ lng: 108, lat: 21 }] })
    await wrapper.vm.$nextTick()

    expect(findBtn()?.classes()).not.toContain('not-mounted')
    expect(findBtn()?.classes()).toContain('active')
    expect(findBtn()?.attributes('title')).toBeUndefined()
  })
})

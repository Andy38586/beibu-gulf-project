const { mockManager } = vi.hoisted(() => ({
  mockManager: {
    has: vi.fn(() => true),
    getMeta: vi.fn((key: string) =>
      key.startsWith('hub') ? { visible: false, engines: ['openlayers'] } : undefined
    ),
    setVisible: vi.fn(),
    isNotMounted: vi.fn(() => false),
  },
}))

vi.mock('@/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core')>()
  return { ...actual, useBusinessLayers: () => ({ manager: mockManager }) }
})

// ⚠ 面板对 useBusinessLayers 是**子路径直引**（core/map/composables/...），
// 只 mock '@/core' 桶拦不到——必须同 mock 子路径（2026-09-30 组开关测试踩坑）
vi.mock('@/core/map/composables/useBusinessLayers', () => ({
  useBusinessLayers: () => ({ manager: mockManager }),
}))

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMapStore } from '@/stores'
import type { MapRenderer } from '@/types'

import LayerControlPanel from '../components/LayerControlPanel.vue'

// ⚠ 决策反转留痕（2026-09-30 用户规则）：本文件原为 c043 判据（容量公式 + 滚动出口，
// "不写 ≤8 钉死常数"）——该口径**废止**。新规：图层面板硬上限 8 条、不滚动、超限
// 截断 + DEV 报错；组开关（一钮控多层）渲染为组行；面板禁滑块。
// 反转的红样即旧判据的用例（12 条注入曾全量呈现滚动，现截断为 8 且报错）。

const PANEL_MAX_ROWS = 8

function mountPanel(options?: { props?: Record<string, unknown> }) {
  return mount(LayerControlPanel, options)
}

describe('LayerControlPanel 面板 8 条硬上限（2026-09-30 规则）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('🔴 注入 12 条业务图层：截断到恰好 8 条 + DEV console.error（删截断即红）', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mapStore = useMapStore()
    mapStore.setCurrentRenderer({ getType: () => '2d' } as unknown as MapRenderer)
    for (let i = 0; i < 12; i++) {
      mapStore.registerBusinessLayer(`layer-${i}`, `图层${i}`, 'points', false, ['openlayers'])
    }
    const wrapper = mountPanel()
    const rows = wrapper.findAll('.layer-btn')
    expect(rows.length).toBe(PANEL_MAX_ROWS)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('超上限 8'))
    errSpy.mockRestore()
  })

  it('≤8 条时全量呈现且不报错（截断不误伤）', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mapStore = useMapStore()
    mapStore.setCurrentRenderer({ getType: () => '2d' } as unknown as MapRenderer)
    for (let i = 0; i < 5; i++) {
      mapStore.registerBusinessLayer(`layer-${i}`, `图层${i}`, 'points', false, ['openlayers'])
    }
    const wrapper = mountPanel()
    expect(wrapper.findAll('.layer-btn').length).toBe(5)
    expect(errSpy).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('面板内不允许出现滑块（用户规则：禁滑块；若有人加 range 立即红）', () => {
    const mapStore = useMapStore()
    mapStore.setCurrentRenderer({ getType: () => '2d' } as unknown as MapRenderer)
    mapStore.registerBusinessLayer('layer-0', '图层0', 'points', false, ['openlayers'])
    const wrapper = mountPanel()
    expect(wrapper.find('input[type="range"]').exists()).toBe(false)
  })
})

describe('LayerControlPanel 组开关（一钮控多层）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('组行点击：全部成员 setVisible 同值；组亮=任一成员可见', async () => {
    const mapStore = useMapStore()
    mapStore.setCurrentRenderer({ getType: () => '2d' } as unknown as MapRenderer)
    // 三个"枢纽"成员 + 一个普通层（普通层不进组）
    for (const k of ['hub-a', 'hub-b', 'hub-c']) {
      mapStore.registerBusinessLayer(k, k, 'points', false, ['openlayers'])
    }
    const wrapper = mountPanel({
      props: {
        layerGroups: [{ key: 'hubs', label: '枢纽 BIM', memberKeys: ['hub-a', 'hub-b', 'hub-c'] }],
      },
    })
    const rows = wrapper.findAll('.layer-btn')
    expect(rows.length).toBe(1) // 组成员被隐藏，只剩组行
    expect(rows[0].text()).toContain('枢纽 BIM')
    await rows[0].trigger('click')
    // 组开关行为断言（钉死一钮控多层）：handleToggleGroup → BLM.setVisible
    // 对全部未锁定成员以同一值调用。mockManager.getMeta 对 hub* 返回 visible:false
    // ⇒ 组行初始灭态，点击后三成员各收到 setVisible(true)。
    const { useBusinessLayers } = await import('@/core')
    const mgr = useBusinessLayers().manager as unknown as typeof mockManager
    mockManager.setVisible.mockClear()
    await rows[0].trigger('click')
    expect(mockManager.setVisible).toHaveBeenCalledTimes(3)
    for (const k of ['hub-a', 'hub-b', 'hub-c']) {
      expect(mgr).toBeTruthy()
      expect(mockManager.setVisible).toHaveBeenCalledWith(k, true)
    }
  })
})

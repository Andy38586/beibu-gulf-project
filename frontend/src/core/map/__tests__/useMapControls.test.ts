import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { MAP_CONFIG } from '@/core/config/map'
import { UNIFIED_MAP_KEY, type UnifiedMapExposed } from '@/core/provideKeys'

import { useMapControls } from '../composables/useMapControls'

// App.vue 是 UNIFIED_MAP_KEY 的 provide 者，也是 zoomToRegion/stopBreathing 的消费方；
// Vue 的 provide 对**自身**不可注入 ⇒ App 侧必须显式传 unifiedMapRef。
// 2026-10-04 运行时实测（修复前）：Profile 页 z9 → 手动 z6 → push('/') 后仍 z6，
// 未复位到 REGION z9（zoomToRegion 静默空转）。这里钉两条通道与一条阳性对照。

function fakeMap() {
  return {
    flyTo: vi.fn(),
    startBreathing: vi.fn(),
    stopBreathing: vi.fn(),
    startFacilityBreathing: vi.fn(),
    stopFacilityBreathing: vi.fn(),
    getRenderer: vi.fn(),
  } as unknown as UnifiedMapExposed
}

describe('useMapControls — 显式 ref（provide 者自己的通道）', () => {
  it('显式传 ref：zoomToRegion 真落到 map 实例（REGION 中心/高度）', () => {
    const map = fakeMap()
    const mapRef = ref<UnifiedMapExposed | null>(map)
    let api!: ReturnType<typeof useMapControls>
    mount({
      setup() {
        api = useMapControls(mapRef)
        return () => null
      },
    })
    api.zoomToRegion()
    expect(map.flyTo).toHaveBeenCalledTimes(1)
    const [target, options] = (map.flyTo as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(target).toEqual(MAP_CONFIG.VIEW_LEVELS.REGION.center)
    // 两字段都传：2D(OL) 用 zoom=9（与 OL 初始视图一致）、3D 用 height（Cesium 忽略 zoom）
    expect(options).toEqual({
      height: MAP_CONFIG.VIEW_LEVELS.REGION.height,
      zoom: MAP_CONFIG.VIEW_LEVELS.REGION.zoom,
    })
  })

  it('阳性对照：无 provide 且未传 ref ⇒ map 为 null，flyTo 不被调用（修复前 App 的形态）', () => {
    const map = fakeMap()
    let api!: ReturnType<typeof useMapControls>
    mount({
      setup() {
        api = useMapControls()
        return () => null
      },
    })
    api.zoomToRegion()
    expect(map.flyTo).not.toHaveBeenCalled()
  })

  it('provide 路径（后代组件）不变：inject 仍生效', () => {
    const map = fakeMap()
    const mapRef = ref<UnifiedMapExposed | null>(map)
    let api!: ReturnType<typeof useMapControls>
    mount(
      {
        setup() {
          api = useMapControls()
          return () => null
        },
      },
      { global: { provide: { [UNIFIED_MAP_KEY]: mapRef } } }
    )
    api.stopBreathing()
    expect(map.stopBreathing).toHaveBeenCalledTimes(1)
  })
})

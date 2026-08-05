/**
 * UnifiedMap 3D 渲染器重建集成测试（Bug B 修复验证）
 *
 * 场景：CesiumViewerManager 30s 闲置销毁 viewer 后回到 3D 路由。
 * 修复逻辑（UnifiedMap.vue initRenderer）：
 * - 复用前检查 cesiumViewerManager.getInstance()（viewer 是否存活）
 * - null（已销毁）→ 丢弃旧 CesiumRenderer 引用，走首次创建分支二次创建
 *   （不调 existingRenderer.destroy()：viewer 已被 Cesium destroy，
 *     destroy 内部访问 this.viewer.scene 会抛 TypeError）
 * - 非 null（存活）→ 直接 mount 复用
 */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { BusinessLayerManager } from '@/core/map/BusinessLayerManager'
import { BUSINESS_LAYER_MANAGER_KEY } from '@/core/map/composables/useBusinessLayers'
import { createRenderer } from '@/core/map/renderers'
import UnifiedMap from '@/core/map/UnifiedMap.vue'
import { useMapStore } from '@/stores'
import type { cesiumViewerManager as CesiumViewerManagerType } from '@/core/map/renderers/CesiumRenderer'

// CesiumRenderer 必须动态 import：顶层静态 import 会在用例收集阶段加载真实 cesium 库，
// 导致 worker 初始化超时（收集阶段挂起）。运行时动态加载与生产路径一致。
let cesiumViewerManager: typeof CesiumViewerManagerType

vi.mock('@/core/map/composables/usePortLayer', () => ({
  loadPorts: vi.fn().mockResolvedValue([
    { id: 'p1', name: 'test-port', lng: 108.1, lat: 21.5, type: 'bulk' },
  ]),
  buildPortGeoJson: vi.fn((ports: unknown[]) => ({
    type: 'FeatureCollection',
    features: ports.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [(p as { lng: number }).lng, (p as { lat: number }).lat] },
      properties: p,
    })),
  })),
  PORT_STYLE: { size: 12, color: '#409eff', labelField: 'name', featureType: 'port' },
}))

vi.mock('@/core/map/composables/useBoundaryLayer', () => ({
  loadBoundaryGeoJson: vi.fn().mockResolvedValue({
    type: 'FeatureCollection',
    features: [],
  }),
  BOUNDARY_STYLE: {
    strokeColor: 'rgba(0, 80, 179, 0.8)',
    strokeWidth: 2,
    fillColor: 'rgba(77,171,247,0.15)',
    featureType: 'boundary',
  },
}))

vi.mock('@/core/map/renderers', () => {
  const createMockRenderer = (type: string) => ({
    _layers: new Map(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    addPointLayer: vi.fn(),
    addGeoJsonLayer: vi.fn(),
    setVisibility: vi.fn(),
    setBaseLayer: vi.fn(),
    exportState: vi.fn().mockReturnValue({}),
    importState: vi.fn(),
    destroy: vi.fn(),
    updateSize: vi.fn(),
    getMap: vi.fn().mockReturnValue({}),
    getViewer: vi.fn().mockReturnValue({}),
    getType: vi.fn().mockReturnValue(type === '2d' ? '2d' : '3d'),
  })

  const createRenderer = vi.fn((type: string) => createMockRenderer(type))

  return { createRenderer }
})

const mockedCreateRenderer = vi.mocked(createRenderer)

function makeMountOptions(store: ReturnType<typeof useMapStore>) {
  const businessLayerManager = new BusinessLayerManager(store)
  return {
    global: {
      provide: {
        mapStore: store,
        [BUSINESS_LAYER_MANAGER_KEY]: businessLayerManager,
      },
    },
    attachTo: document.body!,
  }
}

async function settle() {
  // jsdom 无真实 layout：waitForContainerVisible 需 10 次 rAF 循环（~160ms）后超时放行，
  // 等待必须覆盖该窗口，否则 initRenderer 还没走到 createRenderer 断言就失败了。
  await new Promise((resolve) => setTimeout(resolve, 250))
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 250))
}

describe('UnifiedMap 3D 渲染器重建（Bug B：30s 闲置销毁后二次创建）', () => {
  let wrapper: VueWrapper<InstanceType<typeof UnifiedMap>>
  let pinia: ReturnType<typeof createPinia>
  let mapStore: ReturnType<typeof useMapStore>

  beforeAll(async () => {
    const mod = await import('@/core/map/renderers/CesiumRenderer')
    cesiumViewerManager = mod.cesiumViewerManager
  })

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    mapStore = useMapStore()
    vi.clearAllMocks()
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  it('30s 销毁后回 3D：getInstance 为 null → 二次创建渲染器（且不调旧实例 destroy）', async () => {
    // 真实单例初始 viewer=null（等价于已销毁状态）
    const getInstanceSpy = vi.spyOn(cesiumViewerManager, 'getInstance')
    getInstanceSpy.mockReturnValue(null)

    wrapper = mount(UnifiedMap, {
      props: { mapType: '2d' },
      ...makeMountOptions(mapStore),
    })
    await settle()
    expect(createRenderer).toHaveBeenCalledTimes(1) // OL 首次创建

    // 进 3D：Cesium 首次创建
    await wrapper.setProps({ mapType: '3d' })
    await settle()
    expect(createRenderer).toHaveBeenCalledTimes(2)
    const firstCesiumRenderer = mockedCreateRenderer.mock.results[1].value

    // 去 2D：OL 复用
    await wrapper.setProps({ mapType: '2d' })
    await settle()
    expect(createRenderer).toHaveBeenCalledTimes(2)

    // 回 3D：viewer 已销毁（getInstance=null）→ 二次创建
    await wrapper.setProps({ mapType: '3d' })
    await settle()
    expect(createRenderer).toHaveBeenCalledTimes(3)
    expect(createRenderer).toHaveBeenLastCalledWith('3d', expect.any(HTMLElement))
    // 旧实例的 destroy 不应被调（viewer 已销毁，调 destroy 会访问 this.viewer.scene 崩）
    expect(firstCesiumRenderer.destroy).not.toHaveBeenCalled()
  })

  it('30s 内回 3D：getInstance 非 null → mount 复用，不二次创建', async () => {
    const getInstanceSpy = vi.spyOn(cesiumViewerManager, 'getInstance')
    getInstanceSpy.mockReturnValue({} as never)
    const mountSpy = vi.spyOn(cesiumViewerManager, 'mount')

    wrapper = mount(UnifiedMap, {
      props: { mapType: '2d' },
      ...makeMountOptions(mapStore),
    })
    await settle()

    await wrapper.setProps({ mapType: '3d' })
    await settle()
    expect(createRenderer).toHaveBeenCalledTimes(2)

    await wrapper.setProps({ mapType: '2d' })
    await settle()

    // viewer 存活 → 回 3D 复用
    await wrapper.setProps({ mapType: '3d' })
    await settle()
    expect(createRenderer).toHaveBeenCalledTimes(2) // 复用，不重建
    expect(mountSpy).toHaveBeenCalledTimes(1)
  })
})

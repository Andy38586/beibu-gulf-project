/**
 * D6 复核：2D↔3D 引擎切换时 useForecastLayer 的注册/可见性行为。
 *
 * 监工疑点：「`manager.has(key)` 短路 ⇒ 新渲染器缺实例」。
 * 本文件用**真实 BusinessLayerManager + 真实 layerAdapters**（只把 renderer 换成
 * 记录实例台账的假件）复现 UnifiedMap 的切换链：
 *   setCurrentRenderer(new) → setupLayers() → reapplyAll(new) → watch 回调
 * 因为 `manager.has()` 查的是 registry（跨渲染器持久），实例才是随渲染器生灭 ——
 * 两者必须分开验证，mock 掉 manager 的旧测试看不出这件事。
 */
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

import { BusinessLayerManager } from '@/core/map/BusinessLayerManager'
import type { MapRenderer } from '@/types'
import { useForecastStore } from '@/stores/forecastStore'
import { useMapStore } from '@/stores/mapStore'

const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }))
const holder = vi.hoisted(() => ({ manager: null as unknown }))

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

// 只替换「注入来源」：manager 本身是真实实现，故 BLM 的 register/reapplyAll 语义参与断言。
// 必须 mock **useBusinessLayers 模块本体**（而不是 '@/core' 的再导出）：useOwnedLayers 内部
// 直接 import './useBusinessLayers'，只 mock 桶文件会让「注册」走 no-op 桩、断言却盯着真 BLM。
vi.mock('@/core/map/composables/useBusinessLayers', () => ({
  useBusinessLayers: () => ({ manager: holder.manager }),
  BUSINESS_LAYER_MANAGER_KEY: Symbol('businessLayerManager'),
}))

vi.mock('@/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared')>()
  return {
    ...actual,
    useApiRequest: () => ({ apiRequest: mockApiRequest }),
    handleAuthError: vi.fn(),
    showError: vi.fn(),
  }
})

// 顺序依赖：vi.mock 之后才能拿到被测模块
import { useForecastLayer } from '../useForecastLayer'
import { useForecastRequest } from '../useForecastRequest'

/** 2D 假渲染器：图层台账 + 热力图能力（heatmap 适配器只认 OL） */
function createFake2dRenderer() {
  const layers = new Set<string>()
  const renderer = {
    getType: () => '2d' as const,
    hasLayer: (key: string) => layers.has(key),
    addHeatmapLayer: vi.fn((key: string) => {
      layers.add(key)
    }),
    updateHeatmapLayer: vi.fn(),
    removeLayer: vi.fn((key: string) => {
      layers.delete(key)
    }),
    setVisibility: vi.fn(),
    isLayerVisible: (key: string) => layers.has(key),
    layers,
  }
  return renderer
}

/** 3D 假渲染器：无 addHeatmapLayer ⇒ heatmap 适配器按 engines=[OPENLAYERS] 跳过 */
function createFake3dRenderer() {
  const layers = new Set<string>()
  return {
    getType: () => '3d' as const,
    hasLayer: (key: string) => layers.has(key),
    removeLayer: vi.fn((key: string) => {
      layers.delete(key)
    }),
    setVisibility: vi.fn(),
    layers,
  }
}

const MAP_DATA = { features: [{ type: 'Feature', geometry: null }] }

/** 跑一次 updateForecastLayer（注册 + 首次上图） */
async function renderOnce() {
  const { startTransaction } = useForecastRequest()
  const t = startTransaction()
  const { updateForecastLayer } = useForecastLayer()
  await updateForecastLayer(t.transactionId, t.signal)
}

/** 把 watch 的异步回调（内部 await nextTick）推到落地 */
async function flushWatch() {
  await nextTick()
  await nextTick()
}

describe('useForecastLayer × 引擎切换（D6）', () => {
  let mapStore: ReturnType<typeof useMapStore>
  let manager: BusinessLayerManager

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockApiRequest.mockResolvedValue(MAP_DATA)
    mapStore = useMapStore()
    manager = new BusinessLayerManager(mapStore)
    holder.manager = manager
    useForecastStore().activeIndicator = 'cargo'
  })

  it('疑点复核：切换渲染器后 reapplyAll 在**新渲染器**上重建实例（has() 短路不导致缺实例）', async () => {
    const rendererA = createFake2dRenderer()
    mapStore.setCurrentRenderer(rendererA as unknown as MapRenderer)

    const scope = effectScope()
    scope.run(() => useForecastLayer())
    await renderOnce()
    expect(rendererA.hasLayer('forecast-cargo')).toBe(true)

    // 模拟 UnifiedMap.initRenderer 的切换链（顺序与源码一致）
    const rendererB = createFake2dRenderer()
    mapStore.setCurrentRenderer(rendererB as unknown as MapRenderer)
    manager.reapplyAll(rendererB as unknown as MapRenderer)
    await flushWatch()

    // registry 跨渲染器持久（has() 为真），实例由 reapplyAll 按 registry.data 重建 ⇒ 不缺
    expect(manager.has('forecast-cargo')).toBe(true)
    expect(rendererB.hasLayer('forecast-cargo')).toBe(true)
    scope.stop()
  })

  it('相邻缺陷：用户关掉当前指标图层后切换渲染器，不得被 watch 误开', async () => {
    const rendererA = createFake2dRenderer()
    mapStore.setCurrentRenderer(rendererA as unknown as MapRenderer)

    const scope = effectScope()
    scope.run(() => useForecastLayer())
    await renderOnce()

    // 用户在图层面板关掉当前指标
    manager.setVisible('forecast-cargo', false)
    expect(manager.getMeta('forecast-cargo')?.visible).toBe(false)

    // 切引擎：reapplyAll 因 visible=false 跳过（不重建），随后 watch 回调跑起来
    const rendererB = createFake2dRenderer()
    mapStore.setCurrentRenderer(rendererB as unknown as MapRenderer)
    manager.reapplyAll(rendererB as unknown as MapRenderer)
    await flushWatch()

    // 可见性是用户意图，引擎切换不该改写它
    expect(manager.getMeta('forecast-cargo')?.visible).toBe(false)
    expect(rendererB.hasLayer('forecast-cargo')).toBe(false)
    scope.stop()
  })

  it('切到 3D 时 heatmap 依 engines=[OPENLAYERS] 不建实例，且不改写 registry 可见性', async () => {
    const renderer2d = createFake2dRenderer()
    mapStore.setCurrentRenderer(renderer2d as unknown as MapRenderer)

    const scope = effectScope()
    scope.run(() => useForecastLayer())
    await renderOnce()

    const renderer3d = createFake3dRenderer()
    mapStore.setCurrentRenderer(renderer3d as unknown as MapRenderer)
    manager.reapplyAll(renderer3d as unknown as MapRenderer)
    await flushWatch()

    expect(renderer3d.hasLayer('forecast-cargo')).toBe(false)
    expect(manager.getMeta('forecast-cargo')?.visible).toBe(true)
    scope.stop()
  })
})

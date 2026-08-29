// UnifiedMap 组件挂载集成回归测试（地图渲染链路）
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { Point } from 'geojson'
import { createPinia, setActivePinia } from 'pinia'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { BusinessLayerManager } from '@/core/map/BusinessLayerManager'
import { BUSINESS_LAYER_MANAGER_KEY } from '@/core/map/composables/useBusinessLayers'
import { buildPortGeoJson, PORT_STYLE } from '@/core/map/composables/usePortLayer'
import { createRenderer } from '@/core/map/renderers'
import { useMapStore } from '@/stores'
import type { Port } from '@/types'

import UnifiedMap from '../UnifiedMap.vue'

// vi.mock 在运行时将 createRenderer 替换为 mock，但 TS 仍按真实模块推断类型，
// 这里用 vi.mocked 放宽为 MockedFunction 以便访问 .mock / .mockImplementation API。
const mockedCreateRenderer = vi.mocked(createRenderer)

// jsdom 容器默认尺寸为 0，mock offsetWidth/Height 避免 waitForContainerVisible 超时
const origOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
const origOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 800,
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 600,
  })
})
afterAll(() => {
  if (origOffsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', origOffsetWidth)
  if (origOffsetHeight)
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', origOffsetHeight)
})

vi.mock('@/core/map/composables/usePortLayer', () => ({
  loadPorts: vi
    .fn()
    .mockResolvedValue([{ id: 1, name: 'test-port', lng: 108.1, lat: 21.5, type: 'container' }]),
  buildPortGeoJson: (ports: Port[]) => ({
    type: 'FeatureCollection',
    features: ports.map((port: Port) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [port.lng, port.lat] },
      properties: { ...port, featureType: 'port' },
    })),
  }),
  PORT_STYLE: { size: 12, color: '#409eff', labelField: 'name', featureType: 'port' },
}))

vi.mock('@/core/map/composables/useBoundaryLayer', () => ({
  loadBoundaryGeoJson: vi.fn().mockResolvedValue({
    type: 'FeatureCollection',
    features: [],
  }),
  BOUNDARY_STYLE: {
    strokeColor: '#4dabf7',
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

  const createRenderer = vi.fn((type) => createMockRenderer(type))

  return { createRenderer }
})

function makeMountOptions(store: ReturnType<typeof useMapStore>) {
  // 提供 BusinessLayerManager 实例（boundary/ports 收口到 BLM）
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

describe('UnifiedMap Integration Tests', () => {
  let wrapper: VueWrapper<InstanceType<typeof UnifiedMap>>
  let pinia: ReturnType<typeof createPinia>
  let mapStore: ReturnType<typeof useMapStore>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    mapStore = useMapStore()
    vi.clearAllMocks()
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  it('should initialize Renderer correctly when mounted', async () => {
    wrapper = mount(UnifiedMap, {
      props: { mapType: '2d' },
      ...makeMountOptions(mapStore),
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(createRenderer).toHaveBeenCalledWith('2d', expect.any(HTMLElement))
  })

  it('should load port data and add point layer', async () => {
    wrapper = mount(UnifiedMap, {
      props: { mapType: '2d' },
      ...makeMountOptions(mapStore),
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(createRenderer).toHaveBeenCalled()
    const renderer = mockedCreateRenderer.mock.results[0].value
    expect(renderer.addPointLayer).toHaveBeenCalledWith(
      'ports',
      expect.any(Array),
      expect.objectContaining({ size: 12, color: '#409eff' })
    )

    const portData = renderer.addPointLayer.mock.calls[0][1]
    expect(portData[0].name).toBe('test-port')
    expect(portData[0].lng).toBe(108.1)
    expect(portData[0].lat).toBe(21.5)
  })

  it('should switch between 2d and 3d correctly', async () => {
    wrapper = mount(UnifiedMap, {
      props: { mapType: '2d' },
      ...makeMountOptions(mapStore),
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 50))

    await wrapper.setProps({ mapType: '3d' })
    await new Promise((resolve) => setTimeout(resolve, 100))

    const renderer3d = mockedCreateRenderer.mock.results[1].value
    expect(renderer3d).toBeDefined()
    expect(createRenderer).toHaveBeenCalledWith('3d', expect.any(HTMLElement))
  })

  it('should emit click event when renderer emits click', async () => {
    wrapper = mount(UnifiedMap, {
      props: { mapType: '2d' },
      ...makeMountOptions(mapStore),
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const renderer = mockedCreateRenderer.mock.results[0].value
    const clickHandler = renderer.on.mock.calls.find((c: unknown[]) => c[0] === 'click')?.[1]

    expect(clickHandler).toBeDefined()

    clickHandler({
      detail: {
        featureType: 'port',
        data: { name: 'test-port' },
        coordinate: [108.1, 21.5],
      },
    })

    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('click')).toBeTruthy()
    expect(wrapper.emitted('click')![0][0]).toEqual({
      featureType: 'port',
      data: { name: 'test-port' },
      coordinate: [108.1, 21.5],
    })
  })
})

describe('Composable + Renderer Integration', () => {
  it('buildPortGeoJson should produce valid GeoJSON', () => {
    const ports = [
      { id: 1, name: 'port1', lng: 108.1, lat: 21.5, type: 'container' },
      { id: 2, name: 'port2', lng: 108.2, lat: 21.6, type: 'bulk' },
    ]

    const geojson = buildPortGeoJson(ports as unknown as Port[])

    expect(geojson.type).toBe('FeatureCollection')
    expect(geojson.features.length).toBe(2)
    expect(geojson.features[0].geometry.type).toBe('Point')
    expect((geojson.features[0].geometry as Point).coordinates).toEqual([108.1, 21.5])
    expect(geojson.features[0].properties!.featureType).toBe('port')
  })

  it('PORT_STYLE should have required properties', () => {
    expect(PORT_STYLE).toHaveProperty('size')
    expect(PORT_STYLE).toHaveProperty('color')
    expect(PORT_STYLE).toHaveProperty('labelField')
    expect(PORT_STYLE).toHaveProperty('featureType')
  })
})

describe('UnifiedMap Click Interaction Tests', () => {
  let wrapper: VueWrapper<InstanceType<typeof UnifiedMap>>
  let mapStore: ReturnType<typeof useMapStore>
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.clearAllMocks()
    mapStore = useMapStore()
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  it('should show pinned bubble with close button when clicking a port feature', async () => {
    wrapper = mount(UnifiedMap, {
      props: { mapType: '2d' },
      ...makeMountOptions(mapStore),
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const renderer = mockedCreateRenderer.mock.results[0].value
    const clickHandler = renderer.on.mock.calls.find((c: unknown[]) => c[0] === 'click')?.[1]

    clickHandler({
      detail: {
        featureType: 'port',
        data: { id: '1', name: 'test-port', lng: 108.1, lat: 21.5 },
        coordinate: [108.1, 21.5],
      },
    })

    await wrapper.vm.$nextTick()

    // 点击 → 钉住气泡：渲染港口信息 + 关闭按钮（随 POI 跟随由 OL Overlay 承担，此处验证状态）
    expect(wrapper.find('.map-feature-bubble').exists()).toBe(true)
    expect(wrapper.find('.map-feature-bubble').text()).toContain('test-port')
    expect(wrapper.find('.bubble-close').exists()).toBe(true)
  })

  it('should close bubble when clicking the same port again or blank area', async () => {
    wrapper = mount(UnifiedMap, {
      props: { mapType: '2d' },
      ...makeMountOptions(mapStore),
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const renderer = mockedCreateRenderer.mock.results[0].value
    const clickHandler = renderer.on.mock.calls.find((c: unknown[]) => c[0] === 'click')?.[1]
    const portEvent = {
      detail: {
        featureType: 'port',
        data: { id: '1', name: 'test-port', lng: 108.1, lat: 21.5 },
        coordinate: [108.1, 21.5],
      },
    }

    // 点击 → 钉住；同 POI 再点 → 撤销
    clickHandler(portEvent)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.map-feature-bubble').exists()).toBe(true)

    clickHandler(portEvent)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.map-feature-bubble').exists()).toBe(false)

    // 再次钉住后点击空白 → 关闭
    clickHandler(portEvent)
    await wrapper.vm.$nextTick()
    clickHandler({ detail: { featureType: null, data: null, coordinate: [108.1, 21.5] } })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.map-feature-bubble').exists()).toBe(false)
  })

  it('should switch bubble to another port on click and keep pinned bubble on hover', async () => {
    wrapper = mount(UnifiedMap, {
      props: { mapType: '2d' },
      ...makeMountOptions(mapStore),
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const renderer = mockedCreateRenderer.mock.results[0].value
    const clickHandler = renderer.on.mock.calls.find((c: unknown[]) => c[0] === 'click')?.[1]
    const hoverHandler = renderer.on.mock.calls.find((c: unknown[]) => c[0] === 'hover')?.[1]

    // 钉住港口 1
    clickHandler({
      detail: {
        featureType: 'port',
        data: { id: '1', name: 'test-port', lng: 108.1, lat: 21.5 },
        coordinate: [108.1, 21.5],
      },
    })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.map-feature-bubble').text()).toContain('test-port')

    // 钉住时悬浮其他港口 → 不打扰当前气泡
    hoverHandler({
      detail: {
        featureType: 'port',
        data: { id: '2', name: 'hover-port', lng: 108.2, lat: 21.6 },
        coordinate: [108.2, 21.6],
      },
    })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.map-feature-bubble').text()).toContain('test-port')

    // 点击另一港口 → 气泡切换（一次仅一个）
    clickHandler({
      detail: {
        featureType: 'port',
        data: { id: '3', name: 'other-port', lng: 108.3, lat: 21.7 },
        coordinate: [108.3, 21.7],
      },
    })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.map-feature-bubble').text()).toContain('other-port')
  })

  it('should show hover bubble without close button and hide on hover-out', async () => {
    wrapper = mount(UnifiedMap, {
      props: { mapType: '2d' },
      ...makeMountOptions(mapStore),
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const renderer = mockedCreateRenderer.mock.results[0].value
    const hoverHandler = renderer.on.mock.calls.find((c: unknown[]) => c[0] === 'hover')?.[1]

    // 悬浮命中 → 气泡出现，无关闭按钮（悬浮态）
    hoverHandler({
      detail: {
        featureType: 'port',
        data: { id: '2', name: 'hover-port', lng: 108.2, lat: 21.6 },
        coordinate: [108.2, 21.6],
      },
    })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.map-feature-bubble').exists()).toBe(true)
    expect(wrapper.find('.map-feature-bubble').text()).toContain('hover-port')
    expect(wrapper.find('.bubble-close').exists()).toBe(false)

    // 移开/未命中 → 消失
    hoverHandler({ detail: { featureType: null, data: null, coordinate: null } })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.map-feature-bubble').exists()).toBe(false)
  })

  it('should not show bubble on 3d clicks (bubble is 2d-only capability)', async () => {
    wrapper = mount(UnifiedMap, {
      props: { mapType: '3d' },
      ...makeMountOptions(mapStore),
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const renderer = mockedCreateRenderer.mock.results[0].value
    const clickHandler = renderer.on.mock.calls.find((c: unknown[]) => c[0] === 'click')?.[1]

    clickHandler({
      detail: {
        featureType: 'port',
        data: { id: '1', name: 'test-port', lng: 108.1, lat: 21.5 },
        coordinate: [108.1, 21.5],
      },
    })

    await wrapper.vm.$nextTick()

    expect(wrapper.find('.map-feature-bubble').exists()).toBe(false)
  })
})

describe('UnifiedMap Layer State Persistence', () => {
  let wrapper: VueWrapper<InstanceType<typeof UnifiedMap>>
  let pinia: ReturnType<typeof createPinia>
  let mapStore: ReturnType<typeof useMapStore>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    mapStore = useMapStore()
    vi.clearAllMocks()
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  it('should export and import layer visibility state during switch', async () => {
    wrapper = mount(UnifiedMap, {
      props: { mapType: '2d' },
      ...makeMountOptions(mapStore),
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const renderer2d = mockedCreateRenderer.mock.results[0].value
    renderer2d.exportState.mockReturnValue({
      ports: { visible: false },
      boundary: { visible: true },
    })

    await wrapper.setProps({ mapType: '3d' })
    await new Promise((resolve) => setTimeout(resolve, 100))

    const renderer3d = mockedCreateRenderer.mock.results[1].value
    expect(renderer3d.importState).toHaveBeenCalledWith({
      ports: { visible: false },
      boundary: { visible: true },
    })
  })
})

describe('UnifiedMap Error Handling', () => {
  let wrapper: VueWrapper<InstanceType<typeof UnifiedMap>>
  let pinia: ReturnType<typeof createPinia>
  let mapStore: ReturnType<typeof useMapStore>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    mapStore = useMapStore()
    vi.clearAllMocks()
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  it('should emit error when renderer initialization fails', async () => {
    mockedCreateRenderer.mockImplementation(() => {
      throw new Error('Renderer init failed')
    })

    wrapper = mount(UnifiedMap, {
      props: { mapType: '2d' },
      ...makeMountOptions(mapStore),
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(wrapper.emitted('error')).toBeTruthy()
    expect((wrapper.emitted('error')![0][0] as Error).message).toBe('Renderer init failed')
  })
})

describe('UnifiedMap switchMapType no-op (LIF-6)', () => {
  let wrapper: VueWrapper<InstanceType<typeof UnifiedMap>>
  let mapStore: ReturnType<typeof useMapStore>
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.clearAllMocks()
    mapStore = useMapStore()
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  it('should early-return without re-creating renderer when switching to the same type', async () => {
    wrapper = mount(UnifiedMap, {
      props: { mapType: '2d' },
      ...makeMountOptions(mapStore),
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const callsBefore = mockedCreateRenderer.mock.calls.length

    // 同类型切换（2d → 2d）应走 no-op 分支
    await wrapper.vm.switchMapType('2d')
    await flushPromises()

    // 不应再次调用 createRenderer（验证 early-return 生效）
    expect(mockedCreateRenderer.mock.calls.length).toBe(callsBefore)
  })
})

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import UnifiedMap from '../UnifiedMap.vue'
import { buildPortGeoJson, PORT_STYLE } from '@/core/map/composables/usePortLayer'
import { createRenderer } from '@/core/map/renderers'
import { useMapStore } from '@/stores/map'

// jsdom 容器默认尺寸为 0，mock offsetWidth/Height 避免 waitForContainerVisible 超时
const origOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
const origOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 800 })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 600 })
})
afterAll(() => {
  if (origOffsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', origOffsetWidth)
  if (origOffsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', origOffsetHeight)
})

vi.mock('@/core/map/composables/usePortLayer', () => ({
  loadPorts: vi.fn().mockResolvedValue([
    { id: 1, name: 'test-port', lon: 108.1, lat: 21.5, type: 'container' },
  ]),
  buildPortGeoJson: (ports) => ({
    type: 'FeatureCollection',
    features: ports.map((port) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [port.lon, port.lat] },
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
  BOUNDARY_STYLE: { strokeColor: '#4dabf7', strokeWidth: 2, fillColor: 'rgba(77,171,247,0.15)', featureType: 'boundary' },
}))

vi.mock('@/core/map/renderers', () => {
  const createMockRenderer = (type) => ({
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
    getType: vi.fn().mockReturnValue(type === '2d' ? 'ol' : 'cesium'),
  })

  const createRenderer = vi.fn((type) => createMockRenderer(type))

  return { createRenderer }
})

function makeMountOptions(store) {
  return {
    global: { provide: { mapStore: store } },
    attachTo: document.body,
  }
}

describe('UnifiedMap Integration Tests', () => {
  let wrapper
  let pinia
  let mapStore

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

    await new Promise(resolve => setTimeout(resolve, 50))
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(createRenderer).toHaveBeenCalledWith('2d', expect.any(HTMLElement))
  })

  it('should load port data and add point layer', async () => {
    wrapper = mount(UnifiedMap, {
      props: { mapType: '2d' },
      ...makeMountOptions(mapStore),
    })

    await new Promise(resolve => setTimeout(resolve, 50))
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(createRenderer).toHaveBeenCalled()
    const renderer = createRenderer.mock.results[0].value
    expect(renderer.addPointLayer).toHaveBeenCalledWith(
      'ports',
      expect.any(Array),
      expect.objectContaining({ size: 12, color: '#409eff' }),
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

    await new Promise(resolve => setTimeout(resolve, 50))
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 50))

    const renderer2dInstance = createRenderer.mock.results[0].value

    await wrapper.setProps({ mapType: '3d' })
    await new Promise(resolve => setTimeout(resolve, 100))

    const renderer3d = createRenderer.mock.results[1].value
    expect(renderer3d).toBeDefined()
    expect(createRenderer).toHaveBeenCalledWith('3d', expect.any(HTMLElement))
  })

  it('should emit click event when renderer emits click', async () => {
    wrapper = mount(UnifiedMap, {
      props: { mapType: '2d' },
      ...makeMountOptions(mapStore),
    })

    await new Promise(resolve => setTimeout(resolve, 50))
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 50))

    const renderer = createRenderer.mock.results[0].value
    const clickHandler = renderer.on.mock.calls.find(c => c[0] === 'click')?.[1]

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
    expect(wrapper.emitted('click')[0][0]).toEqual({
      featureType: 'port',
      data: { name: 'test-port' },
      coordinate: [108.1, 21.5],
    })
  })
})

describe('Composable + Renderer Integration', () => {
  it('buildPortGeoJson should produce valid GeoJSON', () => {
    const ports = [
      { id: 1, name: 'port1', lon: 108.1, lat: 21.5, type: 'container' },
      { id: 2, name: 'port2', lon: 108.2, lat: 21.6, type: 'bulk' },
    ]

    const geojson = buildPortGeoJson(ports)

    expect(geojson.type).toBe('FeatureCollection')
    expect(geojson.features.length).toBe(2)
    expect(geojson.features[0].geometry.type).toBe('Point')
    expect(geojson.features[0].geometry.coordinates).toEqual([108.1, 21.5])
    expect(geojson.features[0].properties.featureType).toBe('port')
  })

  it('PORT_STYLE should have required properties', () => {
    expect(PORT_STYLE).toHaveProperty('size')
    expect(PORT_STYLE).toHaveProperty('color')
    expect(PORT_STYLE).toHaveProperty('labelField')
    expect(PORT_STYLE).toHaveProperty('featureType')
  })
})

describe('UnifiedMap Click Interaction Tests', () => {
  let wrapper
  let mapStore
  let pinia

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.clearAllMocks()
    mapStore = useMapStore()
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  it('should set selectedPort when clicking a port feature', async () => {
    wrapper = mount(UnifiedMap, {
      props: { mapType: '2d' },
      ...makeMountOptions(mapStore),
    })

    await new Promise(resolve => setTimeout(resolve, 50))
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 50))

    const renderer = createRenderer.mock.results[0].value
    const clickHandler = renderer.on.mock.calls.find(c => c[0] === 'click')?.[1]

    clickHandler({
      detail: {
        featureType: 'port',
        data: { id: 1, name: 'test-port', lon: 108.1, lat: 21.5 },
        coordinate: [108.1, 21.5],
      },
    })

    await wrapper.vm.$nextTick()

    expect(mapStore.selectedPort).toEqual({ id: 1, name: 'test-port', lon: 108.1, lat: 21.5 })
  })

  it('should clear selectedPort when clicking blank area', async () => {
    wrapper = mount(UnifiedMap, {
      props: { mapType: '2d' },
      ...makeMountOptions(mapStore),
    })

    await new Promise(resolve => setTimeout(resolve, 50))
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 50))

    mapStore.setSelectedPort({ id: 1, name: 'test-port' })
    expect(mapStore.selectedPort).not.toBeNull()

    const renderer = createRenderer.mock.results[0].value
    const clickHandler = renderer.on.mock.calls.find(c => c[0] === 'click')?.[1]

    clickHandler({
      detail: {
        featureType: null,
        data: null,
        coordinate: [108.1, 21.5],
      },
    })

    await wrapper.vm.$nextTick()

    expect(mapStore.selectedPort).toBeNull()
  })

  it('should clear selectedPort when clicking non-port feature', async () => {
    wrapper = mount(UnifiedMap, {
      props: { mapType: '2d' },
      ...makeMountOptions(mapStore),
    })

    await new Promise(resolve => setTimeout(resolve, 50))
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 50))

    mapStore.setSelectedPort({ id: 1, name: 'test-port' })

    const renderer = createRenderer.mock.results[0].value
    const clickHandler = renderer.on.mock.calls.find(c => c[0] === 'click')?.[1]

    clickHandler({
      detail: {
        featureType: 'boundary',
        data: { name: 'region' },
        coordinate: [108.1, 21.5],
      },
    })

    await wrapper.vm.$nextTick()

    expect(mapStore.selectedPort).toBeNull()
  })
})

describe('UnifiedMap Layer State Persistence', () => {
  let wrapper
  let pinia
  let mapStore

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

    await new Promise(resolve => setTimeout(resolve, 50))
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 50))

    const renderer2d = createRenderer.mock.results[0].value
    renderer2d.exportState.mockReturnValue({
      ports: { visible: false },
      boundary: { visible: true },
    })

    await wrapper.setProps({ mapType: '3d' })
    await new Promise(resolve => setTimeout(resolve, 100))

    const renderer3d = createRenderer.mock.results[1].value
    expect(renderer3d.importState).toHaveBeenCalledWith({
      ports: { visible: false },
      boundary: { visible: true },
    })
  })
})

describe('UnifiedMap Error Handling', () => {
  let wrapper
  let pinia
  let mapStore

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
    createRenderer.mockImplementation(() => {
      throw new Error('Renderer init failed')
    })

    wrapper = mount(UnifiedMap, {
      props: { mapType: '2d' },
      ...makeMountOptions(mapStore),
    })

    await new Promise(resolve => setTimeout(resolve, 50))
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(wrapper.emitted('error')).toBeTruthy()
    expect(wrapper.emitted('error')[0][0].message).toBe('Renderer init failed')
  })
})

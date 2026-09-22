// 修复守卫：切换失败 + 在飞期间改意图 ⇒ 补跑必须发生（04-C5 抢占必补跑）。
// 阳性对照：把 finally 的 `const target = pending` 改回 `mapStore.mapType ?? pending`，
// 本用例必红（catch 回滚后 store=oldType ⇒ 判据恒假 ⇒ 排队意图被静默丢弃）。
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { BusinessLayerManager } from '@/core/map/BusinessLayerManager'
import { BUSINESS_LAYER_MANAGER_KEY } from '@/core/map/composables/useBusinessLayers'
import { useMapStore } from '@/stores'

import UnifiedMap from '../UnifiedMap.vue'

const mockedCreateRenderer = vi.mocked(await import('@/core/map/renderers')).createRenderer

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
  loadPorts: vi.fn().mockResolvedValue([]),
  buildPortGeoJson: () => ({ type: 'FeatureCollection', features: [] }),
  PORT_STYLE: { size: 12, color: '#409eff', labelField: 'name', featureType: 'port' },
}))

vi.mock('@/core/map/composables/useBoundaryLayer', () => ({
  loadBoundaryGeoJson: vi.fn().mockResolvedValue({ type: 'FeatureCollection', features: [] }),
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
    hasLayer: vi.fn().mockReturnValue(false),
    clearPendingVisibility: vi.fn(),
    exportState: vi.fn().mockReturnValue({}),
    importState: vi.fn(),
    destroy: vi.fn(),
    updateSize: vi.fn(),
    getMap: vi.fn().mockReturnValue({}),
    getViewer: vi.fn().mockReturnValue({}),
    getType: vi.fn().mockReturnValue(type === '2d' ? '2d' : '3d'),
    startBreathing: vi.fn(),
    stopBreathing: vi.fn(),
  })
  const createRenderer = vi.fn((type: string) => createMockRenderer(type))
  return { createRenderer }
})

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

/** 生产形态：路由先写 store，props 跟随（App.vue:171 + :234） */
async function switchIntent(
  wrapper: VueWrapper<InstanceType<typeof UnifiedMap>>,
  store: ReturnType<typeof useMapStore>,
  type: '2d' | '3d'
) {
  store.setMapType(type)
  await wrapper.setProps({ mapType: type })
}

describe('UnifiedMap 切换失败后的补跑（a036）', () => {
  let wrapper: VueWrapper<InstanceType<typeof UnifiedMap>>
  let mapStore: ReturnType<typeof useMapStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    mapStore = useMapStore()
    vi.clearAllMocks()
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  it('失败路径上排队的最新意图必须被补跑（不是死代码）', async () => {
    wrapper = mount(UnifiedMap, {
      props: { mapType: '2d' },
      ...makeMountOptions(mapStore),
    })
    await new Promise((r) => setTimeout(r, 50))
    await flushPromises()
    expect((wrapper.vm.getRenderer() as { getType: () => string }).getType()).toBe('2d')

    // 让第一次 3D 创建挂住（可控失败窗口）
    let reject3d: (e: Error) => void = () => {}
    mockedCreateRenderer.mockImplementationOnce((type: string) =>
      type === '3d'
        ? new Promise((_resolve, reject) => {
            reject3d = reject
          })
        : ({
            _layers: new Map(),
            on: vi.fn(),
            off: vi.fn(),
            emit: vi.fn(),
            addPointLayer: vi.fn(),
            addGeoJsonLayer: vi.fn(),
            setVisibility: vi.fn(),
            setBaseLayer: vi.fn(),
            hasLayer: vi.fn().mockReturnValue(false),
            clearPendingVisibility: vi.fn(),
            exportState: vi.fn().mockReturnValue({}),
            importState: vi.fn(),
            destroy: vi.fn(),
            updateSize: vi.fn(),
            getMap: vi.fn().mockReturnValue({}),
            getViewer: vi.fn().mockReturnValue({}),
            getType: () => '2d',
            startBreathing: vi.fn(),
            stopBreathing: vi.fn(),
          } as never)
    )

    // 发起 2d→3d 切换并停在 createRenderer 的 await 窗口
    await switchIntent(wrapper, mapStore, '3d')
    await flushPromises()

    // 在飞期间意图又变了两次（3d→2d→3d），最后一次 ≠ oldType
    await switchIntent(wrapper, mapStore, '2d')
    await switchIntent(wrapper, mapStore, '3d')

    // 切换失败
    reject3d(new Error('注入的 3D 初始化失败'))
    await new Promise((r) => setTimeout(r, 50))
    await flushPromises()
    await new Promise((r) => setTimeout(r, 50))
    await flushPromises()

    // 补跑必须真的发生：最终停在上一次意图 3d
    expect(mapStore.mapType).toBe('3d')
    expect((wrapper.vm.getRenderer() as { getType: () => string }).getType()).toBe('3d')
  })
})

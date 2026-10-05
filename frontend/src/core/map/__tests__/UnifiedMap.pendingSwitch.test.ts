// 修复守卫：切换失败 + 在飞期间改意图 ⇒ 补跑必须发生（04-C5 抢占必补跑）。
//
// 阳性对照（2026-09-23 实跑订正）：原注释声称"把 finally 的 `const target = pending` 改回
// `mapStore.mapType ?? pending`，本用例必红"——**实测为假**：该场景里 catch 的两个前置都命中，
// store 停在 newType，与 pending 同值，两种判据等价 ⇒ 变异后仍全绿（宣称与实测不符）。
// 订正后的两条可跑对照（均已实跑）：
//   ① 把 finally 的 `const target = pending` 改回 `mapStore.mapType ?? pending`
//      ⇒「补跑判据以 pending 为准」用例必红（该用例把 store 外部改写成 2d 而 pending=3d）；
//   ② 删掉 catch 回滚里 `mapStore.mapType === newType` 这个前置
//      ⇒「回滚前置①」用例必红（store 已是更晚意图时仍被写回过期 oldType）。
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { BusinessLayerManager } from '@/core/map/BusinessLayerManager'
import { loadBoundaryGeoJson } from '@/core/map/composables/useBoundaryLayer'
import { BUSINESS_LAYER_MANAGER_KEY } from '@/core/map/composables/useBusinessLayers'
import { loadPorts } from '@/core/map/composables/usePortLayer'
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

  it('🔴 补跑判据以 pending 为准：store 被外部改写时不得丢排队意图', async () => {
    // 与上一条的差别只在最后一步：排完队后**外部**（路由 watcher / 其它 store 写入，
    // 不经 props）把 store 改成 2d ⇒ finally 时 store('2d') ≠ pending('3d')。
    // 旧判据 `mapStore.mapType ?? pending` 恒取 store ⇒ 补跑判据落在"渲染器=2d"而判假，
    // pending 的 3d 被静默丢弃（本用例必红）。
    wrapper = mount(UnifiedMap, {
      props: { mapType: '2d' },
      ...makeMountOptions(mapStore),
    })
    await new Promise((r) => setTimeout(r, 50))
    await flushPromises()

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

    await switchIntent(wrapper, mapStore, '3d')
    await flushPromises()
    await switchIntent(wrapper, mapStore, '2d')
    await switchIntent(wrapper, mapStore, '3d') // 排队的最新意图 = 3d

    // 外部改写 store（props 不动 ⇒ 不触发本组件 watch）
    mapStore.setMapType('2d')

    reject3d(new Error('注入的 3D 初始化失败'))
    await new Promise((r) => setTimeout(r, 50))
    await flushPromises()
    await new Promise((r) => setTimeout(r, 50))
    await flushPromises()

    // 补跑必须以 pending 为准：渲染器最终为 3d（旧判据下停在 2d）
    expect((wrapper.vm.getRenderer() as { getType: () => string }).getType()).toBe('3d')
  })

  it('🔴 回滚前置①：store 已不是 newType（更新的意图）时不写回过期 oldType', async () => {
    // 场景必须同时满足两点才能**隔离出**前置①（缺一则被前置②挡住，断言就锁错了对象）：
    //   · pendingSwitchType 为空（未排队）——否则前置② 先拦下，删不删前置①都一个样；
    //   · 在飞期间 store 被外部改写成 oldType（路由/其它 store 写入，props 不动）——
    //     于是 catch 时 store('2d') ≠ newType('3d')，只有前置① 能挡住这次回滚写。
    // 判据取"store 未被再次写入"（值域只有 2d/3d，写回同值在值层面不可观测，
    // 故断言落在调用层——前置① 的语义正是"不要发生这次写"）。
    wrapper = mount(UnifiedMap, {
      props: { mapType: '2d' },
      ...makeMountOptions(mapStore),
    })
    await new Promise((r) => setTimeout(r, 50))
    await flushPromises()

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

    await switchIntent(wrapper, mapStore, '3d')
    await flushPromises()
    // 外部写回（不经 props ⇒ 不触发 watch ⇒ pending 保持为 null）
    mapStore.setMapType('2d')
    expect(mapStore.mapType).toBe('2d')

    const setMapTypeSpy = vi.spyOn(mapStore, 'setMapType')
    reject3d(new Error('注入的 3D 初始化失败'))
    await new Promise((r) => setTimeout(r, 50))
    await flushPromises()
    await new Promise((r) => setTimeout(r, 50))
    await flushPromises()

    // 前置① 拦住回滚写；store 保持更新的意图
    expect(setMapTypeSpy).not.toHaveBeenCalled()
    expect(mapStore.mapType).toBe('2d')
  })

  it('🔴 初始引擎仍在建时切入 3D：不得提前跳过，遮罩须撑到 3D 真正就绪', async () => {
    // 初始 loadData 挂起 ⇒ currentRenderer 保持 null；此时路由把意图写成 3d
    let releasePorts: (v: unknown[]) => void = () => {}
    const pendingPorts = new Promise<unknown[]>((resolve) => {
      releasePorts = resolve
    })
    vi.mocked(loadPorts).mockImplementationOnce(() => pendingPorts as never)
    void loadBoundaryGeoJson // 该模块同被 mock，此处仅表明数据链同源

    wrapper = mount(UnifiedMap, {
      props: { mapType: '2d' },
      ...makeMountOptions(mapStore),
    })
    await flushPromises()
    expect(wrapper.vm.getRenderer()).toBeNull() // 初始引擎未建（loadData 仍挂起）

    await switchIntent(wrapper, mapStore, '3d')
    await flushPromises()

    // 旧实现用 store('3d') 判「类型相同」⇒ 提前跳过并关遮罩：本断言必红
    const mask = wrapper.find('.map-loading')
    expect(mask.exists()).toBe(true)
    expect(mask.text()).toContain('3D')

    // 放行初始 loadData ⇒ onMounted 以当前意图 3d 建渲染器；switchMapType 等它落地
    releasePorts([])
    await flushPromises()
    await new Promise((r) => setTimeout(r, 50))
    await flushPromises()

    const renderer = wrapper.vm.getRenderer() as { getType: () => string } | null
    expect(renderer?.getType()).toBe('3d')
    expect(wrapper.find('.map-loading').exists()).toBe(false)
    // 只允许一次 3D 创建：等待 initialInit，而非与它并发二次 initRenderer
    expect(mockedCreateRenderer.mock.calls.filter((c) => c[0] === '3d')).toHaveLength(1)
  })
})

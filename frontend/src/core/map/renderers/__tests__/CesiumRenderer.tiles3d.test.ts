// CesiumRenderer 3D Tiles 测试
// 背景：新增 '3dtiles' 图层能力。Cesium3DTileset 存于 scene.primitives，与既有两类 instance
// 容器（imageryLayers / dataSources）都不同 ⇒ 三个必须在测试里钉死的语义：
//   ① 挂载是异步的（fromUrl），成功后才登记 _layers（否则 BLM 会认为图层不存在而反复重建）；
//   ② 失败返回 false 且不抛（与 addGeoTIFFLayer 一致，避免中断 reapplyAll 整批重绘）；
//   ③ 移除必须命中 primitives 分支——否则 instance 会落到 dataSources.remove，
//      Cesium 不认该对象 → 静默不释放（GPU 缓冲与瓦片缓存泄漏，且不报错）。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromUrlMock } = vi.hoisted(() => ({ fromUrlMock: vi.fn() }))

// 全量 mock cesium：提供显式具名导出（避免递归 Proxy 在 vitest 模块加载期崩溃）
vi.mock('cesium', () => {
  function makeChainable(): object {
    return new Proxy(function () {}, {
      get(_t: unknown, prop: string | symbol) {
        if (prop === 'then') return undefined
        if (prop === 'fromCssColorString') return () => ({})
        return makeChainable()
      },
      apply() {
        return makeChainable()
      },
      construct() {
        return makeChainable()
      },
    })
  }

  class MockCesiumClass {
    constructor() {
      return makeChainable() as unknown as MockCesiumClass
    }
  }

  return {
    CallbackProperty: MockCesiumClass,
    Cartesian2: MockCesiumClass,
    Cartesian3: Object.assign(MockCesiumClass, { fromDegrees: vi.fn(() => ({}) as object) }),
    Cartographic: MockCesiumClass,
    Cesium3DTileset: Object.assign(MockCesiumClass, { fromUrl: fromUrlMock }),
    Color: { fromCssColorString: () => ({ withAlpha: () => ({}) }) },
    ColorGeometryInstanceAttribute: Object.assign(MockCesiumClass, { fromColor: () => ({}) }),
    Ellipsoid: MockCesiumClass,
    GeographicTilingScheme: MockCesiumClass,
    GeometryInstance: MockCesiumClass,
    Math: { toRadians: () => 0, fromRadians: () => 0 },
    PerInstanceColorAppearance: MockCesiumClass,
    PointGraphics: MockCesiumClass,
    PolygonGeometry: MockCesiumClass,
    PolygonHierarchy: MockCesiumClass,
    Primitive: MockCesiumClass,
    Rectangle: MockCesiumClass,
    ScreenSpaceEventType: MockCesiumClass,
    SingleTileImageryProvider: MockCesiumClass,
    UrlTemplateImageryProvider: MockCesiumClass,
    Viewer: MockCesiumClass,
  }
})

import { add3DTilesLayer, CesiumRenderer, doRemoveLayer } from '../CesiumRenderer'

type LayerEntry = { instance: unknown; visible: boolean; options?: unknown }

/** 构造一个最小可用的 tileset 替身：测试只关心 tileFailed 监听与 statistics 日志读值 */
function makeTileset(total = 18) {
  return {
    show: true,
    tileFailed: { addEventListener: vi.fn() },
    statistics: { numberOfTilesTotal: total },
  }
}

/** 白盒访问：渲染器运行时成员不在公开类型里，测试需显式暴露 */
type CesiumRendererTestAccess = InstanceType<typeof CesiumRenderer> & {
  _layers: Map<string, LayerEntry>
  _pendingVisibility: Map<string, boolean>
}

function setup(id = 'pinglu-hubs') {
  const primitives = {
    add: vi.fn(),
    remove: vi.fn(),
    contains: vi.fn(() => true),
  }
  const imageryLayers = { contains: vi.fn(() => false), remove: vi.fn() }
  const dataSources = { remove: vi.fn() }
  const requestRender = vi.fn()
  const container = { appendChild: vi.fn(), removeChild: vi.fn() } as unknown as HTMLElement
  const renderer = new CesiumRenderer(container) as unknown as CesiumRendererTestAccess
  ;(renderer as unknown as { viewer: unknown }).viewer = {
    scene: { primitives, requestRender },
    imageryLayers,
    dataSources,
  }
  return { renderer, primitives, imageryLayers, dataSources, requestRender, id }
}

describe('CesiumRenderer.add3DTilesLayer', () => {
  beforeEach(() => {
    fromUrlMock.mockReset()
  })

  it('挂载成功：fromUrl 收到 URL 与屏误差，瓦片集进 primitives 并登记 _layers', async () => {
    const { renderer, primitives, requestRender, id } = setup()
    const tileset = makeTileset()
    fromUrlMock.mockResolvedValue(tileset)

    const ok = await add3DTilesLayer(renderer, id, '/static/pinglu/tiles/tileset.json', {
      maximumScreenSpaceError: 24,
    })

    expect(ok).toBe(true)
    expect(fromUrlMock).toHaveBeenCalledWith('/static/pinglu/tiles/tileset.json', {
      maximumScreenSpaceError: 24,
    })
    expect(primitives.add).toHaveBeenCalledWith(tileset)
    expect(requestRender).toHaveBeenCalled()
    // 登记进 _layers 是 BLM 判重与显隐分派的唯一依据
    expect(renderer._layers.get(id)?.instance).toBe(tileset)
  })

  it('缺省屏误差：未传 maximumScreenSpaceError 时按 Cesium 默认 16 下发', async () => {
    const { renderer, id } = setup()
    fromUrlMock.mockResolvedValue(makeTileset())
    await add3DTilesLayer(renderer, id, '/static/pinglu/tiles/tileset.json')
    expect(fromUrlMock).toHaveBeenCalledWith('/static/pinglu/tiles/tileset.json', {
      maximumScreenSpaceError: 16,
    })
  })

  it('幂等：同 id 重复添加先移除旧瓦片集，不产生双份实例', async () => {
    const { renderer, primitives, id } = setup()
    const first = makeTileset()
    const second = makeTileset()
    fromUrlMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second)

    await add3DTilesLayer(renderer, id, '/a/tileset.json')
    await add3DTilesLayer(renderer, id, '/b/tileset.json')

    expect(primitives.remove).toHaveBeenCalledWith(first)
    expect(renderer._layers.get(id)?.instance).toBe(second)
    expect(primitives.add).toHaveBeenCalledTimes(2)
  })

  it('viewer 未就绪：直接返回 false，不发请求（不产生浮动 Promise）', async () => {
    const container = { appendChild: vi.fn(), removeChild: vi.fn() } as unknown as HTMLElement
    const renderer = new CesiumRenderer(container) as unknown as CesiumRendererTestAccess
    ;(renderer as unknown as { viewer: unknown }).viewer = null

    const ok = await add3DTilesLayer(renderer, 'p', '/static/x/tileset.json')

    expect(ok).toBe(false)
    expect(fromUrlMock).not.toHaveBeenCalled()
  })

  it('fromUrl 失败：返回 false 且不抛出，图层表不写入', async () => {
    const { renderer, id } = setup()
    fromUrlMock.mockRejectedValue(new Error('404 tileset.json'))

    await expect(add3DTilesLayer(renderer, id, '/static/pinglu/tiles/tileset.json')).resolves.toBe(
      false
    )
    expect(renderer._layers.has(id)).toBe(false)
  })

  it('瓦片内容加载失败：补 tileFailed 监听（Cesium 默认静默，需留痕）', async () => {
    const { renderer, id } = setup()
    const tileset = makeTileset()
    fromUrlMock.mockResolvedValue(tileset)

    await add3DTilesLayer(renderer, id, '/static/pinglu/tiles/tileset.json')

    expect(tileset.tileFailed.addEventListener).toHaveBeenCalledTimes(1)
  })
})

describe('CesiumRenderer.doRemoveLayer 对 3D Tiles 的移除分支', () => {
  it('Cesium3DTileset 走 primitives.remove（不得落到 dataSources.remove）', () => {
    const { renderer, primitives, dataSources } = setup()
    const tileset = makeTileset()
    doRemoveLayer(renderer, { instance: tileset, visible: true })

    expect(primitives.contains).toHaveBeenCalledWith(tileset)
    expect(primitives.remove).toHaveBeenCalledWith(tileset)
    expect(dataSources.remove).not.toHaveBeenCalled()
  })

  it('影像图层仍走 imageryLayers.remove（3D Tiles 分支不改变既有语义）', () => {
    const { renderer, imageryLayers, primitives, dataSources } = setup()
    imageryLayers.contains.mockReturnValue(true)
    const imagery = { show: true }
    doRemoveLayer(renderer, { instance: imagery, visible: true })

    expect(imageryLayers.remove).toHaveBeenCalledWith(imagery, true)
    expect(primitives.remove).not.toHaveBeenCalled()
    expect(dataSources.remove).not.toHaveBeenCalled()
  })
})

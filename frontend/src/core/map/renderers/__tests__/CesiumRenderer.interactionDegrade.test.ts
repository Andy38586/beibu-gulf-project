// CesiumRenderer 交互期降载（z038②）行为测试：
// 相机 moveStart 隐藏重图层（顶点规模达阈值），moveEnd 按各图层 visible 权威值恢复；
// 隐藏只切引擎侧 show，不得改写面板权威值（否则恢复时用错值 = 图层永久消失）。
import { describe, expect, it, vi } from 'vitest'

vi.mock('cesium', () => {
  // 任意 cesium 对象：构造/调用/读属性都返回安全的链式 mock（同 geojson 测试手法）
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
    buildModuleUrl: (relativeUrl: string) => `/cesium/${relativeUrl}`,
    CallbackProperty: MockCesiumClass,
    Cartesian2: MockCesiumClass,
    Cartesian3: Object.assign(MockCesiumClass, { fromDegrees: () => ({}) }),
    Cartographic: MockCesiumClass,
    Cesium3DTileset: MockCesiumClass,
    CesiumTerrainProvider: MockCesiumClass,
    ClassificationType: MockCesiumClass,
    Color: { fromCssColorString: () => ({}) },
    ColorGeometryInstanceAttribute: MockCesiumClass,
    DataSource: MockCesiumClass,
    EllipsoidTerrainProvider: MockCesiumClass,
    Entity: MockCesiumClass,
    EntityCollection: MockCesiumClass,
    GeographicTilingScheme: MockCesiumClass,
    GeoJsonDataSource: MockCesiumClass,
    GeometryInstance: MockCesiumClass,
    HeightReference: MockCesiumClass,
    ImageryLayer: MockCesiumClass,
    Math: { toRadians: () => 0, fromRadians: () => 0 },
    PerInstanceColorAppearance: MockCesiumClass,
    PointGraphics: MockCesiumClass,
    PolygonGeometry: MockCesiumClass,
    PolygonHierarchy: MockCesiumClass,
    Primitive: MockCesiumClass,
    Rectangle: MockCesiumClass,
    sampleTerrain: () => Promise.resolve([]),
    ScreenSpaceEventHandler: MockCesiumClass,
    ScreenSpaceEventType: MockCesiumClass,
    SingleTileImageryProvider: MockCesiumClass,
    SkyBox: MockCesiumClass,
    UrlTemplateImageryProvider: MockCesiumClass,
    Viewer: MockCesiumClass,
  }
})

import { countCoordinatePairs, setupCameraDebounce } from '../../perf/cameraPerf'
import { CesiumRenderer, destroyEvents } from '../CesiumRenderer'

/** 记录监听器的 Cesium 事件替身 */
function makeEvent() {
  const handlers = new Set<() => void>()
  return {
    addEventListener: vi.fn((fn: () => void) => handlers.add(fn)),
    removeEventListener: vi.fn((fn: () => void) => handlers.delete(fn)),
    fire: () => handlers.forEach((fn) => fn()),
    handlers,
  }
}

function makeRenderer() {
  // container 用带 appendChild 的 mock，避免复用路径 CesiumViewerManager.mount 时崩溃
  const container = { appendChild: vi.fn(), removeChild: vi.fn() } as unknown as HTMLElement
  const renderer = new CesiumRenderer(container)
  const camera = { changed: makeEvent(), moveStart: makeEvent(), moveEnd: makeEvent() }
  const scene = { requestRender: vi.fn() }
  renderer.viewer = { isDestroyed: () => false, scene, camera } as never
  return { renderer, camera, scene }
}

describe('CesiumRenderer 交互期降载（z038②）', () => {
  it('countCoordinatePairs：GeoJSON 嵌套形态计数（Polygon/MultiPolygon/非法输入）', () => {
    expect(countCoordinatePairs(undefined)).toBe(0)
    expect(countCoordinatePairs([])).toBe(0)
    // Polygon: 外环 3 点
    expect(
      countCoordinatePairs([
        [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      ])
    ).toBe(3)
    // MultiPolygon: 两部件各 3 点
    expect(
      countCoordinatePairs([
        [
          [
            [0, 0],
            [1, 0],
            [1, 1],
          ],
        ],
        [
          [
            [2, 2],
            [3, 2],
            [3, 3],
          ],
        ],
      ])
    ).toBe(6)
  })

  it('moveStart 隐藏重图层、moveEnd 按 visible 恢复；轻图层不动', () => {
    const { renderer, camera } = makeRenderer()
    setupCameraDebounce(renderer)
    const heavy = [{ show: true }, { show: true }]
    const light = [{ show: true }]
    renderer._layers.set('flood-area', { instance: heavy, visible: true, interactionHeavy: true })
    renderer._layers.set('ports', { instance: light, visible: true })

    camera.moveStart.fire()
    expect(heavy.every((e) => e.show === false)).toBe(true)
    expect(light[0].show).toBe(true)
    // 隐藏期不改面板权威值（恢复判据）
    expect(renderer._layers.get('flood-area')?.visible).toBe(true)

    camera.moveEnd.fire()
    expect(heavy.every((e) => e.show === true)).toBe(true)
  })

  it('用户已隐藏的重图层：恢复时保持隐藏（按 visible 权威值，不亮回来）', () => {
    const { renderer, camera } = makeRenderer()
    setupCameraDebounce(renderer)
    const entities = [{ show: false }]
    renderer._layers.set('hidden-heavy', {
      instance: entities,
      visible: false,
      interactionHeavy: true,
    })
    camera.moveStart.fire()
    expect(entities[0].show).toBe(false)
    camera.moveEnd.fire()
    expect(entities[0].show).toBe(false)
  })

  it('水面（Primitive）同受降载；恢复不改写 water.visible', () => {
    const { renderer, camera } = makeRenderer()
    setupCameraDebounce(renderer)
    const primitive = { show: true }
    const water = {
      primitive,
      height: 0,
      coordinates: [] as [number, number][],
      options: {},
      visible: true,
      terrainBase: [],
      interactionHeavy: true,
    }
    // 测试替身：只需 primitive.show / visible / interactionHeavy 三个被消费成员
    renderer._waterSurfaces = new Map([['water', water]]) as unknown as NonNullable<
      typeof renderer._waterSurfaces
    >

    camera.moveStart.fire()
    expect(primitive.show).toBe(false)
    expect(water.visible).toBe(true)
    camera.moveEnd.fire()
    expect(primitive.show).toBe(true)
  })

  it('销毁时摘除 moveStart/moveEnd 监听（与 changed 同契约，防单例 Viewer 上累加）', () => {
    const { renderer, camera } = makeRenderer()
    setupCameraDebounce(renderer)
    expect(camera.moveStart.handlers.size).toBe(1)
    expect(camera.moveEnd.handlers.size).toBe(1)

    destroyEvents(renderer)
    expect(camera.moveStart.removeEventListener).toHaveBeenCalled()
    expect(camera.moveEnd.removeEventListener).toHaveBeenCalled()
    expect(camera.moveStart.handlers.size).toBe(0)
    expect(camera.moveEnd.handlers.size).toBe(0)
    expect(camera.changed.handlers.size).toBe(0)
  })
})

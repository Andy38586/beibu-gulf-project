// CesiumRenderer._applyGlobePerfTuning 白盒测试（09-11 修复回归）
// 背景：CesiumRenderer.ts 曾把 maximumScreenSpaceError 挂在 **scene** 上
//（as unknown as 绕过类型检查），但该属性属于 **Globe**（cesium d.ts Globe 类）——
// 08-11（441f6a0e）引入以来 3D LOD 优化从未生效（09-10 性能测评实测线上 SSE=2 佐证）。
// 修复：SSE/tileCacheSize/msaaSamples 三件套收口进 _applyGlobePerfTuning，
// 本测试锁定「挂对对象」防回归。
import { describe, expect, it, vi } from 'vitest'

// 全量 mock cesium（同 waterSurface 测试手法）：CesiumRenderer 模块加载需要具名导出，
// 避免递归 Proxy 在 vitest 模块加载期崩溃。本测试只直调 _applyGlobePerfTuning
//（传普通对象），不触 Viewer 构造，mock 成员仅为满足模块加载。
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
    Cartesian3: Object.assign(MockCesiumClass, { fromDegrees: () => ({}) }),
    Cartographic: MockCesiumClass,
    CesiumTerrainProvider: MockCesiumClass,
    ClassificationType: MockCesiumClass,
    Color: { fromCssColorString: () => ({}) },
    ColorGeometryInstanceAttribute: MockCesiumClass,
    DataSource: MockCesiumClass,
    Ellipsoid: MockCesiumClass,
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
    UrlTemplateImageryProvider: MockCesiumClass,
    Viewer: MockCesiumClass,
  }
})

import { cesiumViewerManager } from '../CesiumRenderer'

describe('CesiumRenderer._applyGlobePerfTuning（globe 级性能三件套，09-11 回归锁定）', () => {
  /** Cesium 默认值起手的 fake scene（与真实默认一致：SSE 2 / cache 100 / MSAA 4） */
  function makeScene() {
    const globe = { maximumScreenSpaceError: 2, tileCacheSize: 100 }
    const scene = { globe, msaaSamples: 4 }
    return { scene, globe }
  }

  function apply(): {
    scene: {
      globe: { maximumScreenSpaceError: number; tileCacheSize: number }
      msaaSamples: number
    }
    globe: { maximumScreenSpaceError: number; tileCacheSize: number }
  } {
    const { scene, globe } = makeScene()
    // 直调 ViewerManager 单例方法（SSE 设置本就发生在 manager.create() 链路内）
    cesiumViewerManager._applyGlobePerfTuning(scene)
    return { scene, globe }
  }

  it('SSE=4 写入 scene.globe（而非 scene 本体）——挂错对象回归锁定', () => {
    const { globe } = apply()
    expect(globe.maximumScreenSpaceError).toBe(4)
  })

  it('tileCacheSize=200 写入 scene.globe（同属 Globe 属性）', () => {
    const { globe } = apply()
    expect(globe.tileCacheSize).toBe(200)
  })

  it('msaaSamples=1 写在 scene 上（关核显 4xMSAA 填充率开销）', () => {
    const { scene } = apply()
    expect(scene.msaaSamples).toBe(1)
  })

  it('幂等：重复调用结果一致（Viewer 复用场景安全）', () => {
    const { scene, globe } = makeScene()
    cesiumViewerManager._applyGlobePerfTuning(scene)
    cesiumViewerManager._applyGlobePerfTuning(scene)
    expect(globe.maximumScreenSpaceError).toBe(4)
    expect(globe.tileCacheSize).toBe(200)
    expect(scene.msaaSamples).toBe(1)
  })
})

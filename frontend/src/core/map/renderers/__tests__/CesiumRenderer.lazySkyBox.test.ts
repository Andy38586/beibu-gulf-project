// CesiumRenderer._scheduleLazySkyBox 行为测试（z038③：首进 3D 的 ≈850KB 星空资源懒加载）
// 判据：Viewer 以 skyBox:false 建成后，首帧之外经 idle 补建同一份 Cesium 自带星空；
// 已有星空不覆盖、viewer 已销毁不触碰、构造失败静默（星空非功能必需）。
import { describe, expect, it, vi } from 'vitest'

const skyBoxCalls: Array<Record<string, unknown>> = []
let skyBoxShouldThrow = false

vi.mock('cesium', () => {
  class MockSkyBox {
    constructor(options: Record<string, unknown>) {
      if (skyBoxShouldThrow) throw new Error('asset load failed')
      skyBoxCalls.push(options)
    }
  }
  // 模块加载期只需要具名导出存在；本测试不 new Viewer。
  class MockCesiumClass {}
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
    SkyBox: MockSkyBox,
    UrlTemplateImageryProvider: MockCesiumClass,
    Viewer: MockCesiumClass,
  }
})

import { scheduleLazySkyBox } from '../../perf/cameraPerf'

/** 直接执行 rAF 回调，避免测试依赖 jsdom 帧计时 */
function runScheduledFrame(): void {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 0
  })
}

function makeViewer(overrides: Record<string, unknown> = {}) {
  const scene = {
    skyBox: false as unknown,
    requestRender: vi.fn(),
    ...(overrides.scene as object),
  }
  return {
    isDestroyed: () => false,
    scene,
    ...overrides,
  }
}

describe('CesiumRenderer._scheduleLazySkyBox（z038③ 星空懒加载）', () => {
  it('首帧后补建星空：6 面纹理齐全并触发一次重绘', () => {
    skyBoxCalls.length = 0
    skyBoxShouldThrow = false
    runScheduledFrame()
    const viewer = makeViewer()
    scheduleLazySkyBox(viewer as never)
    expect(skyBoxCalls).toHaveLength(1)
    const sources = skyBoxCalls[0].sources as Record<string, string>
    expect(Object.keys(sources).sort()).toEqual(
      ['negativeX', 'negativeY', 'negativeZ', 'positiveX', 'positiveY', 'positiveZ'].sort()
    )
    expect(sources.positiveX).toContain('tycho2t3_80_px.jpg')
    expect(viewer.scene.skyBox).toBeTruthy()
    expect(viewer.scene.requestRender).toHaveBeenCalledTimes(1)
  })

  it('已有星空不覆盖（幂等：Viewer 复用/重复调度安全）', () => {
    skyBoxCalls.length = 0
    runScheduledFrame()
    const viewer = makeViewer({ scene: { skyBox: { keep: true } } })
    scheduleLazySkyBox(viewer as never)
    expect(skyBoxCalls).toHaveLength(0)
    expect(viewer.scene.skyBox).toEqual({ keep: true })
  })

  it('viewer 已销毁：不触碰、不抛错', () => {
    skyBoxCalls.length = 0
    runScheduledFrame()
    const viewer = makeViewer({ isDestroyed: () => true })
    expect(() => scheduleLazySkyBox(viewer as never)).not.toThrow()
    expect(skyBoxCalls).toHaveLength(0)
  })

  it('星空构造失败静默（非功能必需，不能影响 3D 主链）', () => {
    skyBoxCalls.length = 0
    skyBoxShouldThrow = true
    runScheduledFrame()
    const viewer = makeViewer()
    expect(() => scheduleLazySkyBox(viewer as never)).not.toThrow()
    expect(viewer.scene.skyBox).toBe(false)
    skyBoxShouldThrow = false
  })
})

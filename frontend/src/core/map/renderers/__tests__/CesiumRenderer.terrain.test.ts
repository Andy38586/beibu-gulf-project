// CesiumRenderer 真地形开关重试语义测试（审查 M-11 回归）
// 背景：_setupTerrain 仅在首挂载（非复用分支）执行；首会话地形加载失败后
// _terrainProvider 恒 null，setTerrainEnabled 原直接 return → "真实地形"按钮
// 永久 no-op。现 provider 未就绪且要求开启时触发一次重试（在途守卫防连点）。
import { describe, expect, it, vi } from 'vitest'

// 全量 mock cesium（CesiumRenderer.waterSurface.test.ts 同款工厂）
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
    Color: { fromCssColorString: () => ({}) },
    ColorGeometryInstanceAttribute: MockCesiumClass,
    CesiumTerrainProvider: Object.assign(MockCesiumClass, { fromUrl: () => Promise.resolve({}) }),
    Ellipsoid: MockCesiumClass,
    EllipsoidTerrainProvider: MockCesiumClass,
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

import { CesiumRenderer } from '../CesiumRenderer'

type CesiumRendererTestAccess = InstanceType<typeof CesiumRenderer> & {
  viewer: Record<string, unknown> | null
  _terrainProvider: unknown
}

/** _setupTerrain/_doSetupTerrain 为类私有成员：spy 经此断言类型桥接（勿并入主类型——private 撞型致 never） */
type TerrainSetupAccess = {
  _setupTerrain: () => Promise<void>
  _doSetupTerrain: () => Promise<void>
}

function createRenderer(): CesiumRendererTestAccess {
  const container = { appendChild: vi.fn(), removeChild: vi.fn() } as unknown as HTMLElement
  const renderer = new CesiumRenderer(container) as unknown as CesiumRendererTestAccess
  // viewer 桩：setTerrainEnabled 的存活检查只触达 scene.requestRender 与 isDestroyed
  renderer.viewer = {
    scene: { requestRender: vi.fn() },
    isDestroyed: () => false,
  } as unknown as CesiumRendererTestAccess['viewer']
  return renderer
}

describe('setTerrainEnabled — provider 未就绪的重试语义（审查 M-11 回归）', () => {
  it('provider 为 null 且要求开启 → 触发一次 _setupTerrain 重试（原实现直接 return 成永久 no-op）', () => {
    const renderer = createRenderer()
    const spy = vi
      .spyOn(renderer as unknown as TerrainSetupAccess, '_setupTerrain')
      .mockResolvedValue(undefined)
    renderer.setTerrainEnabled(true)
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('provider 为 null 且要求关闭 → 不触发（椭球面本就是当前态，仅记开关状态）', () => {
    const renderer = createRenderer()
    const spy = vi
      .spyOn(renderer as unknown as TerrainSetupAccess, '_setupTerrain')
      .mockResolvedValue(undefined)
    renderer.setTerrainEnabled(false)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('provider 就绪后走原切换路径，不再触发重试', () => {
    const renderer = createRenderer()
    renderer._terrainProvider = {} as never
    const spy = vi
      .spyOn(renderer as unknown as TerrainSetupAccess, '_setupTerrain')
      .mockResolvedValue(undefined)
    renderer.setTerrainEnabled(true)
    expect(spy).not.toHaveBeenCalled()
    expect((renderer.viewer as { terrainProvider: unknown }).terrainProvider).toBe(
      renderer._terrainProvider
    )
    spy.mockRestore()
  })

  it('初始化在途时并发调用复用同一次建连（在途守卫）', async () => {
    const renderer = createRenderer()
    let resolveDo!: () => void
    const doSpy = vi
      .spyOn(renderer as unknown as TerrainSetupAccess, '_doSetupTerrain')
      .mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveDo = resolve
          })
      )
    const p1 = renderer._setupTerrain()
    const p2 = renderer._setupTerrain()
    resolveDo()
    await Promise.all([p1, p2])
    expect(doSpy).toHaveBeenCalledTimes(1)
    // 完成后在途守卫复位：下次调用开启新一轮
    const p3 = renderer._setupTerrain()
    resolveDo()
    await p3
    expect(doSpy).toHaveBeenCalledTimes(2)
    doSpy.mockRestore()
  })
})

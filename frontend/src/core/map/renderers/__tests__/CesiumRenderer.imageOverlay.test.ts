// CesiumRenderer 单张影像覆盖图层测试
// 背景：新增 'imageOverlay' 能力，用于把离线提取的影像块（天地图拼接图）按地理矩形铺回球面，
// 作为与 3D Tiles 模型同源同坐标系的对齐基准。必须钉死的三点：
//   ① 构造参数完整 —— tilingScheme 缺失会把中纬度矩形投歪，tileWidth/Height 缺失直接抛 DeveloperError；
//   ② alpha 由 options.opacity 驱动（默认不透明，否则盖不住在线底图、失去对照意义）；
//   ③ 失败返回 false 而不抛（与 geotiff/3dtiles 一致，避免中断 reapplyAll 整批重绘）。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { providerArgs, throwOnConstruct } = vi.hoisted(() => ({
  providerArgs: [] as Record<string, unknown>[],
  /** 置 true 时 provider 构造抛错，用于验证失败路径不向上抛 */
  throwOnConstruct: { v: false },
}))

vi.mock('cesium', () => {
  function makeChainable(): object {
    return new Proxy(function () {}, {
      get(_t: unknown, prop: string | symbol) {
        if (prop === 'then') return undefined
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
    Cesium3DTileset: Object.assign(MockCesiumClass, { fromUrl: vi.fn() }),
    Color: { fromCssColorString: () => ({ withAlpha: () => ({}) }) },
    ColorGeometryInstanceAttribute: Object.assign(MockCesiumClass, { fromColor: () => ({}) }),
    Ellipsoid: MockCesiumClass,
    // 记录构造入参供断言；provider 实例只需可被 imageryLayers 接收
    GeographicTilingScheme: class {},
    GeometryInstance: MockCesiumClass,
    Math: { toRadians: () => 0, fromRadians: () => 0 },
    PerInstanceColorAppearance: MockCesiumClass,
    PointGraphics: MockCesiumClass,
    PolygonGeometry: MockCesiumClass,
    PolygonHierarchy: MockCesiumClass,
    Primitive: MockCesiumClass,
    // 真实调用链是 Rectangle.fromDegrees(w, s, e, n)，记录参数验证经纬顺序
    Rectangle: { fromDegrees: vi.fn((...a: number[]) => ({ __rect: a })) },
    ScreenSpaceEventType: MockCesiumClass,
    SingleTileImageryProvider: class {
      constructor(opts: Record<string, unknown>) {
        // 真实实现缺 tileWidth/tileHeight 会抛 DeveloperError，测试用同一路径验证失败兜底
        if (throwOnConstruct.v) throw new Error('DeveloperError: tileWidth must be defined')
        providerArgs.push(opts)
      }
    },
    UrlTemplateImageryProvider: MockCesiumClass,
    Viewer: MockCesiumClass,
  }
})

import { addImageOverlayLayer, CesiumRenderer } from '../CesiumRenderer'

type LayerEntry = { instance: unknown; visible: boolean; options?: unknown }

type TestAccess = InstanceType<typeof CesiumRenderer> & { _layers: Map<string, LayerEntry> }

function setup() {
  const added: unknown[] = []
  const imageryLayer = { show: true, alpha: 1 }
  const imageryLayers = {
    addImageryProvider: vi.fn(() => {
      added.push(imageryLayer)
      return imageryLayer
    }),
    contains: vi.fn(() => true),
    remove: vi.fn(),
  }
  const primitives = { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => false) }
  const requestRender = vi.fn()
  const container = { appendChild: vi.fn(), removeChild: vi.fn() } as unknown as HTMLElement
  const renderer = new CesiumRenderer(container) as unknown as TestAccess
  ;(renderer as unknown as { viewer: unknown }).viewer = {
    scene: { primitives, requestRender },
    imageryLayers,
    dataSources: { remove: vi.fn() },
  }
  return { renderer, imageryLayers, imageryLayer, requestRender, added }
}

const DATA = {
  url: '/static/pinglu/imagery/madao.jpg',
  bbox: [108.92944336, 22.43895625, 108.95141602, 22.4592638] as [number, number, number, number],
  size: [2048, 2048] as [number, number],
}

describe('CesiumRenderer.addImageOverlayLayer', () => {
  beforeEach(() => {
    providerArgs.length = 0
  })

  it('按 bbox 与像素尺寸构造 provider，并登记进 _layers', () => {
    const { renderer, imageryLayers, requestRender } = setup()

    const ok = addImageOverlayLayer(renderer, 'pinglu-imagery-madao', DATA)

    expect(ok).toBe(true)
    expect(providerArgs).toHaveLength(1)
    expect(providerArgs[0]).toMatchObject({
      url: DATA.url,
      tileWidth: 2048,
      tileHeight: 2048,
    })
    // GeographicTilingScheme 必填：默认 WebMercator 会把 22°N 的矩形投歪
    expect(providerArgs[0].tilingScheme).toBeDefined()
    expect(imageryLayers.addImageryProvider).toHaveBeenCalledTimes(1)
    expect(renderer._layers.get('pinglu-imagery-madao')?.instance).toBeDefined()
    expect(requestRender).toHaveBeenCalled()
  })

  it('缺省不透明；传 opacity 时写入 imageryLayer.alpha', () => {
    const a = setup()
    addImageOverlayLayer(a.renderer, 'x', DATA)
    expect(a.imageryLayer.alpha).toBe(1)

    const b = setup()
    addImageOverlayLayer(b.renderer, 'x', DATA, { opacity: 0.6 })
    expect(b.imageryLayer.alpha).toBe(0.6)
  })

  it('viewer 未就绪：返回 false，不构造 provider', () => {
    const container = { appendChild: vi.fn(), removeChild: vi.fn() } as unknown as HTMLElement
    const renderer = new CesiumRenderer(container) as unknown as TestAccess
    ;(renderer as unknown as { viewer: unknown }).viewer = null

    const ok = addImageOverlayLayer(renderer, 'x', DATA)

    expect(ok).toBe(false)
    expect(providerArgs).toHaveLength(0)
  })

  it('provider 构造抛错（像素尺寸非法等）：返回 false 且不抛出', () => {
    const { renderer } = setup()
    throwOnConstruct.v = true
    try {
      const ok = addImageOverlayLayer(renderer, 'x', DATA)
      expect(ok).toBe(false)
      // 失败时不得登记图层，否则 BLM 会认为已挂载而不再重试
      expect(renderer._layers.has('x')).toBe(false)
    } finally {
      throwOnConstruct.v = false
    }
  })
})

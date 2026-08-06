// CesiumRenderer 水面增量更新可达性测试（z082）
// 背景：06908b5 实现了 updateWaterLevel（复用 Primitive 仅替换 geometryInstances），
// 但 MapRenderer.hasLayer 只查 _layers，水面存于 _waterSurfaces → BLM.updateData
// 判据 !hasLayer(key) 恒真 → 每次水位变化都走 create（remove+add 全量重建），
// 增量代码是死代码。修复：CesiumRenderer 覆写 hasLayer 覆盖 _waterSurfaces。
import { describe, expect, it, vi } from 'vitest'

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
    Cartesian3: MockCesiumClass,
    Cartographic: MockCesiumClass,
    Color: { fromCssColorString: () => ({}) },
    ColorGeometryInstanceAttribute: MockCesiumClass,
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

import { BusinessLayerManager } from '../../BusinessLayerManager'
import { CesiumRenderer } from '../CesiumRenderer'

/** 白盒访问：@ts-nocheck 文件运行时成员需显式暴露 */
type CesiumRendererTestAccess = InstanceType<typeof CesiumRenderer> & {
  _waterSurfaces: Map<string, unknown>
  _layers: Map<string, unknown>
  updateWaterLevel: ReturnType<typeof vi.fn>
  addWaterSurface: ReturnType<typeof vi.fn>
}

function createRenderer(): CesiumRendererTestAccess {
  const container = { appendChild: vi.fn(), removeChild: vi.fn() } as unknown as HTMLElement
  return new CesiumRenderer(container) as unknown as CesiumRendererTestAccess
}

describe('CesiumRenderer.hasLayer 覆写（水面存于 _waterSurfaces）', () => {
  // @ts-nocheck 渲染器运行时成员与测试访问类型合并后带具体泛型，赋值统一走断言
  function setWaterSurfaces(renderer: CesiumRendererTestAccess, entries: Array<[string, unknown]>) {
    ;(renderer as { _waterSurfaces: Map<string, unknown> })._waterSurfaces = new Map(entries)
  }

  it('_waterSurfaces 中的水面 id → hasLayer 返回 true（增量更新可达）', () => {
    const renderer = createRenderer()
    setWaterSurfaces(renderer, [['water-surface', { primitive: {} }]])
    renderer._layers = new Map()
    expect(renderer.hasLayer('water-surface')).toBe(true)
  })

  it('_layers 中的普通图层 id → 仍返回 true（基类行为保留）', () => {
    const renderer = createRenderer()
    setWaterSurfaces(renderer, [])
    ;(renderer as { _layers: Map<string, unknown> })._layers = new Map([['ports', {}]])
    expect(renderer.hasLayer('ports')).toBe(true)
  })

  it('两处都不存在的 id → false', () => {
    const renderer = createRenderer()
    setWaterSurfaces(renderer, [])
    renderer._layers = new Map()
    expect(renderer.hasLayer('nope')).toBe(false)
  })

  it('_waterSurfaces 未初始化（undefined）时防御不抛错', () => {
    const renderer = createRenderer()
    ;(renderer as { _waterSurfaces: Map<string, unknown> | undefined })._waterSurfaces = undefined
    renderer._layers = new Map()
    expect(renderer.hasLayer('water-surface')).toBe(false)
  })
})

describe('BLM.updateData 对已创建 waterSurface 走增量 update（不重建）', () => {
  it('hasLayer 命中（修复后语义）→ 调 updateWaterLevel 而非 addWaterSurface', () => {
    const renderer = {
      hasLayer: vi.fn(() => true),
      addWaterSurface: vi.fn(),
      updateWaterLevel: vi.fn(),
      removeWaterSurface: vi.fn(),
      setWaterSurfaceVisibility: vi.fn(),
      getType: () => '3d',
    }
    const store = {
      currentRenderer: renderer,
      layerCatalog: [] as unknown[],
      registerBusinessLayer: vi.fn(),
      setLayerVisible: vi.fn(),
      removeLayer: vi.fn(),
    }
    const blm = new BusinessLayerManager(store as never)

    blm.register('water-surface', {
      label: '水面',
      layerType: 'waterSurface',
      data: { coordinates: [[108.5, 21.5]], height: 1 },
      visible: true,
    })
    expect(renderer.addWaterSurface).toHaveBeenCalledTimes(1) // 注册时 create 一次

    // 水位变化 → updateData → 应走 update（增量），绝不二次 create（重建）
    blm.updateData('water-surface', {
      data: { coordinates: [[108.5, 21.5]], height: 5 },
    })
    expect(renderer.updateWaterLevel).toHaveBeenCalledTimes(1)
    expect(renderer.updateWaterLevel).toHaveBeenCalledWith('water-surface', 5)
    expect(renderer.addWaterSurface).toHaveBeenCalledTimes(1) // 仍是注册那一次
  })

  it('hasLayer 未命中（引擎切换后未重建）→ 走 create 补建（a040 语义保留）', () => {
    const renderer = {
      hasLayer: vi.fn(() => false),
      addWaterSurface: vi.fn(),
      updateWaterLevel: vi.fn(),
      removeWaterSurface: vi.fn(),
      setWaterSurfaceVisibility: vi.fn(),
      getType: () => '3d',
    }
    const store = {
      currentRenderer: renderer,
      layerCatalog: [] as unknown[],
      registerBusinessLayer: vi.fn(),
      setLayerVisible: vi.fn(),
      removeLayer: vi.fn(),
    }
    const blm = new BusinessLayerManager(store as never)
    blm.register('water-surface', {
      label: '水面',
      layerType: 'waterSurface',
      data: { coordinates: [[108.5, 21.5]], height: 1 },
      visible: true,
    })
    blm.updateData('water-surface', {
      data: { coordinates: [[108.5, 21.5]], height: 5 },
    })
    expect(renderer.addWaterSurface).toHaveBeenCalledTimes(2) // 补建
    expect(renderer.updateWaterLevel).not.toHaveBeenCalled()
  })
})

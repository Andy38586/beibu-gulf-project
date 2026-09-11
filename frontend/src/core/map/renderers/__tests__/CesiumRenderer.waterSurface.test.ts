// CesiumRenderer 水面测试
// 背景 1：06908b5 实现了 updateWaterLevel（曾复用 Primitive 仅替换 geometryInstances），
// 但 MapRenderer.hasLayer 只查 _layers，水面存于 _waterSurfaces → BLM.updateData
// 判据 !hasLayer(key) 恒真 → 每次水位变化都走 create（remove+add 全量重建），
// 增量代码是死代码。修复：CesiumRenderer 覆写 hasLayer 覆盖 _waterSurfaces。
// 背景 2（审查 H-1 回归）：「替换 geometryInstances」对 Cesium 状态机不成立——该属性
// 仅在构建期被读取，完成后运行时替换是纯 no-op，水面纹丝不动且旧测试只断言"可调用"，
// 把可疑路径固化成了能跑通。现实现为同步 remove+add 重建几何，本文件断言真实挂载语义。
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
    // _positionCamera 首屏定位用到 Cartesian3.fromDegrees（mock 不做真实坐标运算，返回空对象即可）；
    // vi.fn 记录入参供"新几何含新水位"断言（terrainBase + height 烘进顶点坐标）
    Cartesian3: Object.assign(MockCesiumClass, { fromDegrees: vi.fn(() => ({}) as object) }),
    Cartographic: MockCesiumClass,
    // fromCssColorString(...).withAlpha(alpha) 是 buildWaterInstance 的真实调用链，
    // 返回值必须携带 withAlpha（旧 mock 返回裸 {}，真实路径从未被执行到过）
    Color: { fromCssColorString: () => ({ withAlpha: () => ({}) }) },
    // fromColor 为类上静态调用（MockCesiumClass 无静态成员，须显式提供）
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

import { Cartesian3 } from 'cesium'

import { BusinessLayerManager } from '../../BusinessLayerManager'
import { CesiumRenderer, updateWaterLevel } from '../CesiumRenderer'

/** 白盒访问：渲染器运行时成员（非公开类型）需显式暴露（渲染器本体无 @ts-nocheck后已移除） */
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
  // 渲染器运行时成员与测试访问类型合并后带具体泛型，赋值统一走断言
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

  it('hasLayer 未命中（引擎切换后未重建）→ 走 create 补建（语义保留）', () => {
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

describe('updateWaterLevel — 真实挂载语义：同步 remove+add 重建几何（审查 H-1 回归）', () => {
  function setupEntry(height: number) {
    const renderer = createRenderer()
    const primitives = { add: vi.fn(), remove: vi.fn() }
    const requestRender = vi.fn()
    ;(renderer as unknown as { viewer: unknown }).viewer = { scene: { primitives, requestRender } }
    const oldPrimitive = { marker: 'old' }
    ;(
      renderer as unknown as { _waterSurfaces: Map<string, Record<string, unknown>> }
    )._waterSurfaces = new Map([
      [
        'water-surface',
        {
          primitive: oldPrimitive,
          height,
          coordinates: [[108.5, 21.5]] as [number, number][],
          options: {},
          visible: true,
          terrainBase: [30, 31],
        },
      ],
    ])
    return { renderer, primitives, requestRender, oldPrimitive }
  }

  it('水位变化 → 移除旧 Primitive、挂载新 Primitive，新几何顶点含新水位', () => {
    const { renderer, primitives, requestRender, oldPrimitive } = setupEntry(1)
    vi.mocked(Cartesian3.fromDegrees).mockClear()

    expect(updateWaterLevel(renderer, 'water-surface', 5)).toBe(true)

    // 旧实例被移除、新实例被挂载（替换 geometryInstances 的旧实现两者都不发生）
    expect(primitives.remove).toHaveBeenCalledTimes(1)
    expect(primitives.remove).toHaveBeenCalledWith(oldPrimitive)
    expect(primitives.add).toHaveBeenCalledTimes(1)
    const added = primitives.add.mock.calls[0][0]
    expect(added).not.toBe(oldPrimitive)

    // entry 同步指向新实例与新水位（后续更新沿新 Primitive 继续）
    const entry = (
      renderer as unknown as { _waterSurfaces: Map<string, Record<string, unknown>> }
    )._waterSurfaces.get('water-surface')
    expect(entry?.primitive).toBe(added)
    expect(entry?.height).toBe(5)

    // 几何按新高度重建：顶点高 = 地形基准 30 + 水位 5（旧实现替换属性后 Cesium 不再读取）
    expect(Cartesian3.fromDegrees).toHaveBeenCalledWith(108.5, 21.5, 35)

    // 按需渲染模式需显式请求一帧
    expect(requestRender).toHaveBeenCalledTimes(1)
  })

  it('同值更新 → 跳过重建（滑块拖动触发同值）', () => {
    const { renderer, primitives } = setupEntry(5)
    expect(updateWaterLevel(renderer, 'water-surface', 5)).toBe(true)
    expect(primitives.remove).not.toHaveBeenCalled()
    expect(primitives.add).not.toHaveBeenCalled()
  })

  it('id 不存在 → false 且不动场景', () => {
    const { renderer, primitives } = setupEntry(1)
    expect(updateWaterLevel(renderer, 'nope', 5)).toBe(false)
    expect(primitives.remove).not.toHaveBeenCalled()
    expect(primitives.add).not.toHaveBeenCalled()
  })

  it('构建失败 → 旧 Primitive 原地保留（先建后换，不闪不消失）', () => {
    const { renderer, primitives, oldPrimitive } = setupEntry(1)
    vi.mocked(Cartesian3.fromDegrees).mockImplementationOnce(() => {
      throw new Error('bad coordinate')
    })

    expect(updateWaterLevel(renderer, 'water-surface', 5)).toBe(false)
    expect(primitives.remove).not.toHaveBeenCalled()
    expect(primitives.add).not.toHaveBeenCalled()
    const entry = (
      renderer as unknown as { _waterSurfaces: Map<string, Record<string, unknown>> }
    )._waterSurfaces.get('water-surface')
    expect(entry?.primitive).toBe(oldPrimitive)
    expect(entry?.height).toBe(1)
  })
})

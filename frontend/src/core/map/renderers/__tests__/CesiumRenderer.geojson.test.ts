// CesiumRenderer GeoJSON 加载回归测试（Cesium 引擎渲染链路，D 系列资源治理）
import { describe, expect, it, vi } from 'vitest'

// 全量 mock cesium：提供显式具名导出（避免递归 Proxy 在 vitest 模块加载期崩溃），
// 仅暴露 GeoJsonDataSource.load 供测试可控（默认 resolve 空 entities）。
vi.mock('cesium', () => {
  // 任意 cesium 对象：构造/调用/读属性都返回安全的链式 mock
  function makeChainable(): any {
    return new Proxy(function () {}, {
      get(_t: any, prop: any) {
        if (prop === 'then') return undefined // 避免被当作 thenable
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
      return makeChainable()
    }
  }

  const GeoJsonDataSource = {
    load: vi.fn().mockResolvedValue({ entities: { values: [] } }),
  }

  return {
    CallbackProperty: MockCesiumClass,
    Cartesian2: MockCesiumClass,
    Cartesian3: MockCesiumClass,
    Cartographic: MockCesiumClass,
    Color: { fromCssColorString: () => ({}) },
    ColorGeometryInstanceAttribute: MockCesiumClass,
    GeoJsonDataSource,
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

import { GeoJsonDataSource } from 'cesium'

import { CesiumRenderer } from '../CesiumRenderer'

const mockGeoJson = {
  type: 'FeatureCollection',
  features: [],
} as any

/**
 * LIF-7 验收：addGeoJsonLayer 的 _geoJsonTokens 管理
 * 1. 成功路径回收 token（token Map 不跨 id 累积）
 * 2. 陈旧（被更新的同 id 请求覆盖）请求失败时不触发 onError
 */
describe('CesiumRenderer.addGeoJsonLayer (LIF-7)', () => {
  function createRenderer(): any {
    // container 用带 appendChild 的 mock，避免复用路径 CesiumViewerManager.mount 时崩溃
    // （cesiumViewerManager 是模块级单例，第二次构造会命中复用分支调用 el.appendChild）
    const container = { appendChild: vi.fn(), removeChild: vi.fn() } as unknown as HTMLElement
    return new CesiumRenderer(container)
  }

  it('成功加载后回收 token（_geoJsonTokens 不累积）', async () => {
    const renderer = createRenderer()
    const onError = vi.fn()

    await renderer.addGeoJsonLayer('layer-a', mockGeoJson, { onError })

    expect(onError).not.toHaveBeenCalled()
    // 成功路径 delete(id)，token Map 应为空
    expect(renderer._geoJsonTokens.size).toBe(0)
  })

  it('陈旧（被更新的同 id 请求覆盖）请求失败不触发 onError', async () => {
    const renderer = createRenderer()
    const onError1 = vi.fn()
    const onError2 = vi.fn()

    // 两次加载都失败，模拟并发竞态：第一次先设 token1，第二次覆盖为 token2
    ;(GeoJsonDataSource.load as any).mockRejectedValue(new Error('load failed'))

    const p1 = renderer.addGeoJsonLayer('layer-stale', mockGeoJson, { onError: onError1 })
    const p2 = renderer.addGeoJsonLayer('layer-stale', mockGeoJson, { onError: onError2 })
    await Promise.all([p1, p2])

    // 陈旧请求（先发起、后被覆盖）失败不应调用其 onError
    expect(onError1).not.toHaveBeenCalled()
    // 最新请求失败时也会 delete token，Map 最终清空
    expect(renderer._geoJsonTokens.size).toBe(0)
  })
})

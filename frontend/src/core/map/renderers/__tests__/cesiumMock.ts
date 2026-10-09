/**
 * Cesium 全量 mock 的统一工厂（z046①：此前 10 份测试内联复制同一段 makeChainable + 33 名导出）。
 *
 * 用法（`vi.mock` 工厂被 hoist，不能引用外部变量 ⇒ 工厂内动态 import；需要额外状态时用
 * `vi.hoisted` 声明）：
 *
 * ```ts
 * vi.mock('cesium', async () => (await import('./cesiumMock')).makeCesiumMock())
 * // 覆盖单点（如可控的 GeoJsonDataSource.load）：
 * vi.mock('cesium', async () =>
 *   (await import('./cesiumMock')).makeCesiumMock({ GeoJsonDataSource: { load: vi.fn() } })
 * )
 * ```
 *
 * 名字集合 = `frontend/src/core/map/cesium-global.ts` 的 33 个运行时导出 + `Ellipsoid`
 * （dev shim 与 build external 都按同一集合解析；新增真实导入时两边一起补）。
 */
import { vi } from 'vitest'

/** 任意 Cesium 对象：构造/调用/读属性都返回安全的链式 mock（`then` 置空避免被当 thenable） */
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
  }) as object
}

/** 以 chainable mock 为构造器的类（`new X()` 返回链式对象；覆盖项需要静态成员时配合 Object.assign） */
export function makeChainableClass(): new () => object {
  return class MockCesiumClass {
    constructor() {
      return makeChainable() as unknown as MockCesiumClass
    }
  } as unknown as new () => object
}

/**
 * 构建完整的 cesium 模块替身。`overrides` 里的名字整项替换（浅合并），
 * 典型用途：可控的 `GeoJsonDataSource.load`、捕获式 `SkyBox`、带断言的 `Cartesian3`。
 */
export function makeCesiumMock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const MockCesiumClass = makeChainableClass()
  return {
    buildModuleUrl: (relativeUrl: string) => `/cesium/${relativeUrl}`,
    CallbackProperty: MockCesiumClass,
    Cartesian2: MockCesiumClass,
    // 首屏定位/几何换算用到 fromDegrees；mock 不做真实坐标运算，返回空对象即可
    Cartesian3: Object.assign(makeChainableClass(), { fromDegrees: vi.fn(() => ({})) }),
    Cartographic: MockCesiumClass,
    Cesium3DTileset: MockCesiumClass,
    CesiumTerrainProvider: MockCesiumClass,
    ClassificationType: MockCesiumClass,
    Color: Object.assign(makeChainableClass(), {
      // withAlpha 链在渲染器里真实存在（水面/点色），给足链式返回
      fromCssColorString: vi.fn(() => ({ withAlpha: () => ({}) })),
    }),
    ColorGeometryInstanceAttribute: Object.assign(makeChainableClass(), {
      fromColor: vi.fn(() => ({})),
    }),
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
    // CesiumMath：toRadians/fromRadians/toDegrees 在渲染器里有真实算术用途，不能给链式对象
    Math: { toRadians: () => 0, fromRadians: () => 0, toDegrees: () => 0 },
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
    ...overrides,
  }
}

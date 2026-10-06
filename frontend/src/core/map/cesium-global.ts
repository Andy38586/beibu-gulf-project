/**
 * dev 专用：把 `import … from 'cesium'` 指向**运行时全局 window.Cesium**
 *
 * ## 为什么需要它（2026-09-27 事故，D-J）
 *
 * `vite-plugin-cesium@1.2.23` 的 dev/build 行为**不一致**：
 * - **build**：`config` 钩子把 `cesium` 标为 `external` 并用 `rollup-plugin-external-globals`
 *   映射到全局 `Cesium` ⇒ 源码里的 `import … from 'cesium'` 编译成 `Cesium.*`，全站**一个实例**。
 * - **dev**：只 `define` 了 `CESIUM_BASE_URL`，**没有** external、**也没有**任何 import 改写 ⇒
 *   同一个 `import … from 'cesium'` 走 **npm 的 ESM 包**；而 `renderers/index.ts` 的
 *   `ensureCesiumLoaded()` 又注入 UMD 的 `/cesium/Cesium.js` ⇒ **页面里同时存在两个 Cesium 实例**。
 *
 * 后果：Cesium 内部大量用 `instanceof` 判可见性，跨实例对象被**静默判为不可见** ——
 * 3D Tiles 图层全部 `_selectedTiles=0 / numberOfAttemptedRequests=0`，画面里只有影像、
 * **零报错**（实测：`window.Cesium.Cesium3DTileset !== <renderer 用的那个>`）。
 *
 * ## 本 shim 做的事
 *
 * dev 下把 `cesium` 解析到这里，导出全部指向同一个 `window.Cesium` ⇒ 与 build 路径一致，
 * **全程只有一个实例**。类型不受影响：本文件只用 `import type`（编译期擦除），
 * 而 `vue-tsc` 不认识 vite 的 alias，仍按 npm 包解析类型。
 *
 * ## 维护约定
 *
 * **新增 `import … from 'cesium'` 的运行时名字时，必须同步在下面加一行导出**，
 * 否则该名字在 dev 下会是 `undefined`（只在运行时暴露，构建期不报错）。
 * 当前名单来自 `CesiumRenderer.ts`（全仓唯一运行时消费者，33 个名字）。
 */
import type * as CesiumTypes from 'cesium'

const C = (globalThis as { Cesium?: typeof CesiumTypes }).Cesium

if (!C) {
  throw new Error(
    '[cesium-global] window.Cesium 未就绪：dev 下必须先经 renderers/index.ts 的 ' +
      'ensureCesiumLoaded() 注入 /cesium/Cesium.js，再动态导入 CesiumRenderer。'
  )
}

export const buildModuleUrl = C.buildModuleUrl
export const CallbackProperty = C.CallbackProperty
export const Cartesian2 = C.Cartesian2
export const Cartesian3 = C.Cartesian3
export const Cartographic = C.Cartographic
export const Cesium3DTileset = C.Cesium3DTileset
export const CesiumTerrainProvider = C.CesiumTerrainProvider
export const ClassificationType = C.ClassificationType
export const Color = C.Color
export const ColorGeometryInstanceAttribute = C.ColorGeometryInstanceAttribute
export const DataSource = C.DataSource
export const EllipsoidTerrainProvider = C.EllipsoidTerrainProvider
export const Entity = C.Entity
export const EntityCollection = C.EntityCollection
export const GeographicTilingScheme = C.GeographicTilingScheme
export const GeoJsonDataSource = C.GeoJsonDataSource
export const GeometryInstance = C.GeometryInstance
export const HeightReference = C.HeightReference
export const ImageryLayer = C.ImageryLayer
export const Math = C.Math
export const PerInstanceColorAppearance = C.PerInstanceColorAppearance
export const PointGraphics = C.PointGraphics
export const PolygonGeometry = C.PolygonGeometry
export const PolygonHierarchy = C.PolygonHierarchy
export const Primitive = C.Primitive
export const Rectangle = C.Rectangle
export const sampleTerrain = C.sampleTerrain
export const ScreenSpaceEventHandler = C.ScreenSpaceEventHandler
export const ScreenSpaceEventType = C.ScreenSpaceEventType
export const SingleTileImageryProvider = C.SingleTileImageryProvider
export const SkyBox = C.SkyBox
export const UrlTemplateImageryProvider = C.UrlTemplateImageryProvider
export const Viewer = C.Viewer

// 关键名字缺失时立刻炸，别让"图层开着什么都没有"再静默复现一次
for (const k of ['Viewer', 'Cesium3DTileset', 'Cartesian3'] as const) {
  if (!(k in C)) {
    throw new Error(
      `[cesium-global] window.Cesium 缺少 ${k} —— 检查 /cesium/Cesium.js 是否为完整构建`
    )
  }
}

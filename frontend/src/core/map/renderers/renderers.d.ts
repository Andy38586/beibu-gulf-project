/**
 * 渲染器模块类型声明
 * MapRenderer 已迁移为 .ts（类型内联）。OLRenderer.ts / CesiumRenderer.ts 现已为 .ts，
 * 但顶部带 `// @ts-nocheck`（D-6 技术债），类型注解待逐步补充。
 * 本 d.ts 当前【未被任何模块 import】（renderers/index.ts 自行定义 createRenderer 并从
 * ./OLRenderer 取类；真实的 cesiumViewerManager 是 CesiumRenderer.ts 的 export const）。
 * 即：本文件目前是 inert（有声明、无消费方），与 OLRenderer.ts/CesiumRenderer.ts 处于
 * 不同模块作用域，typecheck 不产生重复/冲突声明。保留它作为 @ts-nocheck 最终移除时的
 * 类型契约参考（TS-1：OLRendererState / CesiumRendererState）。
 * 子类继承父类方法签名，仅声明自身特有的额外方法/成员。
 */

import type { MapRenderer as IMapRenderer } from '@/types'

import type { MapRenderer } from './MapRenderer'

/**
 * Cesium Viewer 最小类型接口
 * 仅声明项目实际使用的 Viewer 属性/方法，避免引入完整 Cesium 类型依赖。
 * 完整类型见 Cesium API 文档：Cesium.Viewer
 */
export interface CesiumViewerLike {
  container: HTMLElement
  resize(): void
  destroy(): void
  /** 实体集合（点/线/面/呼吸灯 entity） */
  entities: {
    values: unknown[]
    add(_entity: unknown): unknown
    remove(_entity: unknown): boolean
    contains(_entity: unknown): boolean
    getById(_id: string): unknown
  }
  /** GeoJSON 等数据源 */
  dataSources: {
    add(_dataSource: unknown): unknown
    remove(_dataSource: unknown, _destroy?: boolean): boolean
  }
  /** 影像图层（天地图底图等） */
  imageryLayers: {
    addImageryProvider(_provider: unknown): unknown
    contains(_layer: unknown): boolean
    remove(_layer: unknown, _destroy?: boolean): boolean
  }
  screenSpaceEventHandler: unknown
  /** viewer.flyTo(entity) —— 飞行到实体 */
  flyTo(_target: unknown): void
  scene: {
    requestRenderMode: boolean
    requestRender(): void
    globe: { enableLighting: boolean }
    screenSpaceCameraController: unknown
    screenSpaceEventHandler: unknown
    pick(_position: unknown): unknown
    primitives: {
      add(_primitive: unknown): unknown
      remove(_primitive: unknown): boolean
    }
    camera: {
      flyTo(_options: unknown): void
      pickEllipsoid(_position: unknown): unknown
      changed: {
        addEventListener(_handler: unknown): void
        removeEventListener(_handler: unknown): void
      }
      position: unknown
      heading: number
      pitch: number
      roll: number
    }
  }
}

// ===== 渲染器运行时成员状态（TS-1：@ts-nocheck 收敛参考）=====
// 两文件当前均带 // @ts-nocheck，下列接口仅作文档化契约，供最终移除 @ts-nocheck 时
// 给成员补强类型参考；类内字段初始化处可加 @type JSDoc 指向此处。

/** OLRenderer 运行时成员状态 */
export interface OLRendererState {
  map: unknown
  baseLayers: { image: unknown[]; vector: unknown[] }
  _cullLayers: Map<string, unknown>
  _moveendKey: unknown
  _breathingLayer: unknown
  _breathingAnimId: number | null
}

/** CesiumRenderer 运行时成员状态 */
export interface CesiumRendererState {
  viewer: CesiumViewerLike | null
  _isReusing: boolean
  _cameraDebounceTimer: number | null
  _waterSurfaces: unknown
  _geoJsonTokens: unknown
  _breathingEntity: unknown
}

declare class OLRenderer extends MapRenderer {}

declare class CesiumRenderer extends MapRenderer {}

declare const cesiumViewerManager: {
  getViewer(): CesiumViewerLike | null
  ensureViewer(_container: HTMLElement): Promise<CesiumViewerLike>
  destroyViewer(): void
  /** @internal 供 CesiumRenderer 设置底图引用 */
  _baseLayers?: { image: unknown[]; vector: unknown[] }
  /** 设置底图引用（供复用时新 CesiumRenderer 实例获取） */
  setBaseLayers(_layers: { image: unknown[]; vector: unknown[] }): void
  /** 获取底图引用 */
  getBaseLayers(): { image: unknown[]; vector: unknown[] } | null
  markBaseLayersInitialized(): void
}

declare function createRenderer(_type: string, _container: HTMLElement): Promise<MapRenderer>

export { CesiumRenderer, cesiumViewerManager, createRenderer, OLRenderer }

// 保持 IMapRenderer 接口的可访问性（业务层通过 @/types 使用接口类型）
export type { IMapRenderer }

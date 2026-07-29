/**
 * 渲染器模块类型声明
 *
 * MapRenderer 已迁移为 .ts，类型内联，无需在此声明。
 * OLRenderer.js / CesiumRenderer.js 仍为 .js，此处声明其 extends MapRenderer 类。
 * 子类继承父类方法签名，仅声明自身特有的额外方法。
 */

import type { MapRenderer as IMapRenderer } from '@/types'

import type { MapRenderer } from './MapRenderer'

/**
 * Cesium Viewer 最小类型接口
 *
 * 仅声明项目实际使用的 Viewer 属性/方法，避免引入完整 Cesium 类型依赖。
 * 完整类型见 Cesium API 文档：Cesium.Viewer
 */
export interface CesiumViewerLike {
  entities: {
    values: unknown[]
    add(_entity: unknown): unknown
    remove(_entity: unknown): boolean
    getById(_id: string): unknown
  }
  scene: {
    primitives: {
      add(_primitive: unknown): unknown
      remove(_primitive: unknown): boolean
    }
    camera: {
      flyTo(_options: unknown): void
      position: unknown
      heading: number
      pitch: number
      roll: number
    }
    screenSpaceEventHandler: unknown
    pick(_position: unknown): unknown
    requestRender(): void
    primitives: unknown
  }
  imageryLayers: unknown
  destroy(): void
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

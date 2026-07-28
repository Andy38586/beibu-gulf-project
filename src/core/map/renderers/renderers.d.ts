/**
 * 渲染器模块类型声明
 *
 * 声明 OLRenderer 和 CesiumRenderer 实现 MapRenderer 接口。
 * 不修改 .js 运行时代码。
 */

import type {
  MapRenderer,
  FlyToTarget,
  FlyToOptions,
  PointFeature,
  PolygonFeature,
  LayerOptions,
  WaterSurfaceOptions,
  RendererState,
} from '@/types'
import type { FeatureCollection } from 'geojson'

declare class OLRenderer extends MapRenderer {
  constructor(_container: HTMLElement)
  init(): Promise<void>
  destroy(): void
  addPointLayer(_id: string, _features: PointFeature[], _options?: LayerOptions): void
  addPolygonLayer(_id: string, _features: PolygonFeature[], _options?: LayerOptions): void
  addGeoJsonLayer(_id: string, _geojson: FeatureCollection, _options?: LayerOptions): void
  addHeatmapLayer(_id: string, _features: PointFeature[], _options?: LayerOptions): boolean
  updateHeatmapLayer(_id: string, _features: PointFeature[], _options?: LayerOptions): boolean
  setVisibility(_id: string, _visible: boolean): void
  removeLayer(_id: string): void
  flyTo(_target: FlyToTarget, _options?: FlyToOptions): void
  exportState(): RendererState
  importState(_state: RendererState): void
  getType(): string
}

declare class CesiumRenderer extends MapRenderer {
  constructor(_container: HTMLElement)
  init(): Promise<void>
  destroy(): void
  addPointLayer(_id: string, _features: PointFeature[], _options?: LayerOptions): void
  addPolygonLayer(_id: string, _features: PolygonFeature[], _options?: LayerOptions): void
  addGeoJsonLayer(_id: string, _geojson: FeatureCollection, _options?: LayerOptions): void
  setVisibility(_id: string, _visible: boolean): void
  removeLayer(_id: string): void
  flyTo(_target: FlyToTarget, _options?: FlyToOptions): void
  exportState(): RendererState
  importState(_state: RendererState): void
  getType(): string
  addWaterSurface(
    _id: string,
    _coordinates: [number, number][],
    _height: number,
    _options?: WaterSurfaceOptions
  ): boolean
  updateWaterLevel(_id: string, _newHeight: number): boolean
  removeWaterSurface(_id: string): boolean
  removeAllWaterSurfaces(): boolean
  setWaterSurfaceVisibility(_id: string, _visible: boolean): boolean
  startBreathing(_lng: number, _lat: number): void
  stopBreathing(): void
}

declare const cesiumViewerManager: {
  getViewer(): unknown // Cesium.Viewer
  ensureViewer(_container: HTMLElement): Promise<unknown>
  destroyViewer(): void
}

declare function createRenderer(_type: string, _container: HTMLElement): Promise<MapRenderer>

export { OLRenderer, CesiumRenderer, cesiumViewerManager, createRenderer }

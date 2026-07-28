/**
 * MapRenderer 抽象接口
 *
 * 双引擎策略模式的核心契约：OpenLayers（2D）与 Cesium（3D）必须实现此接口。
 * 业务层通过此接口操作地图，不直接依赖 OL 或 Cesium API，实现 2D/3D 无感切换。
 *
 * 北部湾港 WebGIS 采用双引擎架构：
 *   - 2D 引擎（OLRenderer）：天地图底图 + 矢量叠加，适合选址分析等平面空间运算
 *   - 3D 引擎（CesiumRenderer）：地形 + 水面可视化，适合浸没分析的立体呈现
 *   引擎切换时通过 exportState/importState 传递 CameraState，保证视角连续。
 *
 * 可选方法（?）：
 * - 2D Only: addHeatmapLayer / updateHeatmapLayer
 * - 3D Only: addWaterSurface / updateWaterLevel / removeWaterSurface / startBreathing / stopBreathing
 *   子类对 "本引擎不支持" 的方法返回 false + DEV warn
 */

import type { GeoPoint } from '@/types/business/base'
import type { FeatureCollection } from 'geojson'

// ===== 基础坐标类型 =====

/** 点要素（渲染器 addPointLayer 入参） */
export interface PointFeature {
  lng: number
  lat: number
  name?: string
  [key: string]: unknown
}

/** 多边形要素（渲染器 addPolygonLayer 入参） */
export interface PolygonFeature {
  coordinates: [number, number][]
  properties?: Record<string, unknown>
}

// ===== FlyTo 目标 =====

export type FlyToTarget = GeoPoint | [number, number] | { layerId: string }

export interface FlyToOptions {
  duration?: number // 毫秒（2D）/ 秒（3D，内部转换）
  zoom?: number
  height?: number
}

// ===== 图层选项 =====

export interface LayerOptions {
  visible?: boolean
  zIndex?: number
  markerColor?: string
  markerSize?: number
}

/** 水面选项（3D Only） */
export interface WaterSurfaceOptions {
  color?: string
  opacity?: number
}

// ===== 状态持久化 =====

/** Camera 状态（用于 2D/3D 切换） */
export interface CameraState {
  center: GeoPoint
  zoom?: number
  height?: number
  heading?: number
  pitch?: number
  roll?: number
}

/** 渲染器导出状态 */
export interface RendererState {
  [layerId: string]: { visible: boolean } | CameraState
}

// ===== 事件 =====

export interface MapRendererEventMap {
  click: { lng: number; lat: number; feature?: unknown }
  'pointer-move': { lng: number; lat: number }
  'camera-changed': CameraState
}

// ===== 主接口 =====

export interface MapRenderer {
  /** 初始化地图实例 */
  init(): Promise<void>

  /** 销毁地图，释放资源 */
  destroy(): void

  /** 添加点图层 */
  addPointLayer(_id: string, _features: PointFeature[], _options?: LayerOptions): void

  /** 添加多边形图层 */
  addPolygonLayer(_id: string, _features: PolygonFeature[], _options?: LayerOptions): void

  /** 添加 GeoJSON 图层 */
  addGeoJsonLayer(_id: string, _geojson: FeatureCollection, _options?: LayerOptions): void

  /** 添加热力图（2D Only） */
  addHeatmapLayer?(_id: string, _features: PointFeature[], _options?: LayerOptions): boolean
  updateHeatmapLayer?(_id: string, _features: PointFeature[], _options?: LayerOptions): boolean

  /** 设置图层显隐 */
  setVisibility(_id: string, _visible: boolean): void

  /** 移除图层 */
  removeLayer(_id: string): void

  /** 飞往目标位置 */
  flyTo(_target: FlyToTarget, _options?: FlyToOptions): void

  /** 导出当前状态（引擎切换用） */
  exportState(): RendererState

  /** 导入状态 */
  importState(_state: RendererState): void

  /** 水面效果（3D Only） */
  addWaterSurface?(
    _id: string,
    _coordinates: [number, number][],
    _height: number,
    _options?: WaterSurfaceOptions
  ): boolean
  updateWaterLevel?(_id: string, _newHeight: number): boolean
  removeWaterSurface?(_id: string): boolean
  removeAllWaterSurfaces?(): boolean
  setWaterSurfaceVisibility?(_id: string, _visible: boolean): boolean

  /** 呼吸灯效果 */
  startBreathing?(_lng: number, _lat: number): void
  stopBreathing?(): void

  /** 事件监听 */
  on<K extends keyof MapRendererEventMap>(
    _event: K,
    _handler: (_data: MapRendererEventMap[K]) => void
  ): void
  off<K extends keyof MapRendererEventMap>(
    _event: K,
    _handler: (_data: MapRendererEventMap[K]) => void
  ): void
  emit<K extends keyof MapRendererEventMap>(_event: K, _data: MapRendererEventMap[K]): void

  /** 获取渲染器类型标识 */
  getType(): string
}

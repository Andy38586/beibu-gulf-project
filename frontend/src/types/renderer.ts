/**
 * MapRenderer 抽象接口
 * 双引擎策略模式的核心契约：OpenLayers（2D）与 Cesium（3D）必须实现此接口。
 * 业务层通过此接口操作地图，不直接依赖 OL 或 Cesium API，实现 2D/3D 无感切换。
 * 北部湾港 WebGIS 采用双引擎架构：
 * - 2D 引擎（OLRenderer）：天地图底图 + 矢量叠加，适合选址分析等平面空间运算
 * - 3D 引擎（CesiumRenderer）：地形 + 水面可视化，适合浸没分析的立体呈现
 * 引擎切换时通过 exportState/importState 传递 CameraState，保证视角连续。
 * 可选方法（?）：
 * - 2D Only: addHeatmapLayer / updateHeatmapLayer
 * - 3D Only: 水面能力见 Water3DCapability 接口（OLRenderer 不支持,业务侧能力检查后调用）
 * - 呼吸动画（startBreathing/stopBreathing）：双引擎公共能力（OL 矢量圈 / Cesium 实体动画）
 * 子类对 "本引擎不支持" 的方法返回 false + DEV warn
 */

import type { FeatureCollection } from 'geojson'

import type { GeoPoint } from '@/types/business/base'

// ===== 基础坐标类型 =====

/** 点要素（渲染器 addPointLayer 入参） */
export interface PointFeature {
  lng: number
  lat: number
  name?: string
  /** 开放扩展：业务层可附加任意属性（如 id、type、featureType），
   * 渲染器通过 options.labelField 等按需读取。
   * 参考 §7.7 索引签名设计约定。 */
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
  // GeoJSON 多边形样式
  strokeColor?: string
  strokeWidth?: number
  fillColor?: string
  // 点图层样式
  size?: number
  color?: string
  labelField?: string
  // 业务要素类型标识（如 'port' / 'boundary'）
  featureType?: string
  // 栅格图层透明度（GeoTIFF hillshade 等，0-1）
  opacity?: number
  // ── 热力图选项（2D Only，a015：显式传入使色带/权重可配置）──
  /** 热力图色带（CSS 颜色字符串数组，从低到高） */
  gradient?: string[]
  /** 权重字段名（feature 属性中作为权重的 key，如 'value'） */
  weightField?: string
  /** 热力点半径（像素） */
  radius?: number
  /** 热力模糊半径（像素） */
  blur?: number
}

/** 水面选项（3D Only） */
export interface WaterSurfaceOptions {
  color?: string
  opacity?: number
}

/**
 * 水面效果能力接口（3D Only，a036 拆分产物）
 *
 * 背景：水面 5 方法原声明在 MapRenderer 基类/接口上，导致基类为 2D 引擎背负
 * 3D 契约（ISP 违反），OLRenderer 只能提供 no-op stub。
 * 现拆为独立能力接口，仅 CesiumRenderer 实现；业务侧（layerAdapters 的
 * waterSurface 分支）调用前做能力检查：`typeof renderer.addWaterSurface === 'function'`，
 * 不支持的渲染器（OL）跳过并 warn。
 *
 * 注意：呼吸动画（startBreathing/stopBreathing）是双引擎公共能力（OL 矢量圈 /
 * Cesium 实体动画），保留在 MapRenderer 接口上，不属本接口。
 */
export interface Water3DCapability {
  addWaterSurface(
    id: string,
    coordinates: [number, number][],
    height: number,
    options?: WaterSurfaceOptions
  ): boolean
  updateWaterLevel(id: string, newHeight: number): boolean
  removeWaterSurface(id: string): boolean
  removeAllWaterSurfaces(): boolean
  setWaterSurfaceVisibility(id: string, visible: boolean): boolean
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
  /** 图层 ID → 图层状态（含 visible）。
   * 特殊键 `_camera` 存储 CameraState（用于 2D/3D 切换时视角传递）。
   * 参考 §7.7。 */
  [layerId: string]: { visible: boolean } | CameraState
}

// ===== 事件 =====

export interface MapRendererEventMap {
  /**
   * 点击事件。
   * - featureType: 命中要素的类型标识（如 'port' / 'forecast-berth'），未命中为 null
   * - data: 命中要素的属性对象，未命中为 null
   * - coordinate: 点击位置的 [lng, lat] 数组
   */
  click: {
    featureType: string | null
    data: Record<string, unknown> | null
    coordinate: [number, number] | null
  }
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

  /** 添加 GeoTIFF 栅格图层（2D Only，真实 DEM 山体阴影/高程着色） */
  addGeoTIFFLayer?(_id: string, _url: string, _options?: LayerOptions): boolean

  /** 添加热力图（2D Only） */
  addHeatmapLayer?(_id: string, _features: PointFeature[], _options?: LayerOptions): boolean
  updateHeatmapLayer?(_id: string, _features: PointFeature[], _options?: LayerOptions): boolean

  /** 设置图层显隐 */
  setVisibility(_id: string, _visible: boolean): void

  /** 移除图层 */
  removeLayer(_id: string): void

  /** 检查图层是否已存在（公开方法，替代直读 _layers 私有 Map） */
  hasLayer(_id: string): boolean

  /** 飞往目标位置 */
  flyTo(_target: FlyToTarget, _options?: FlyToOptions): void

  /** 导出当前状态（引擎切换用） */
  exportState(): RendererState

  /** 导入状态 */
  importState(_state: RendererState): void

  /** 水面效果（3D Only，能力接口见 Water3DCapability） */

  /** 呼吸灯效果（双引擎公共能力：OL 矢量动画圈 / Cesium 实体动画） */
  startBreathing?(_lng: number, _lat: number): void
  stopBreathing?(): void

  /** 事件监听 */
  on<K extends keyof MapRendererEventMap>(
    _event: K,
    _handler: (event: CustomEvent<MapRendererEventMap[K]>) => void
  ): void
  on(_event: string, _handler: EventListenerOrEventListenerObject): void
  off<K extends keyof MapRendererEventMap>(
    _event: K,
    _handler: (event: CustomEvent<MapRendererEventMap[K]>) => void
  ): void
  off(_event: string, _handler: EventListenerOrEventListenerObject): void
  emit<K extends keyof MapRendererEventMap>(_event: K, _data: MapRendererEventMap[K]): void
  emit(_event: string, _data: unknown): void

  /** 获取渲染器类型标识 */
  getType(): string
}

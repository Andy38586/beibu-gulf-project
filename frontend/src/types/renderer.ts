/**
 * MapRenderer 抽象接口：OL（2D）/Cesium（3D）双引擎的共同契约，
 * 业务层只面向此接口操作地图，实现 2D/3D 无感切换；引擎切换用 exportState/importState 传递视角。
 * 单引擎专有能力收敛为可选能力接口（Water3DCapability/GeoTIFFCapability/HeatmapCapability），
 * 调用方先做能力检查再调用；呼吸动画为双引擎公共能力。
 */

import type { FeatureCollection } from 'geojson'

import type { GeoPoint } from '@/types/business/base'

// ===== 基础坐标类型 =====

/** 点要素（渲染器 addPointLayer 入参） */
export interface PointFeature {
  /** 常规输入：lng/lat；GeoJSON Feature 形状（热力图）走 geometry.coordinates */
  lng?: number
  lat?: number
  name?: string
  /** 兼容 GeoJSON Feature 形状；可选——空 geometry 时渲染器回退 (0,0) */
  geometry?: { type?: string; coordinates?: [number, number] }
  properties?: Record<string, unknown>
  /** 开放扩展：业务层可附加任意属性（渲染器经 options.labelField 等按需读取） */
  [key: string]: unknown
}

/** 多边形要素（渲染器 addPolygonLayer 入参） */
export interface PolygonFeature {
  coordinates?: [number, number][]
  properties?: Record<string, unknown>
  /** 兼容 GeoJSON 风格输入（渲染器按 geometry.type 分派 Polygon/MultiPolygon） */
  geometry?: { type: string; coordinates: unknown }
  /** 业务要素类型标识（渲染器透传到 feature 属性） */
  featureType?: string
  [key: string]: unknown
}

// ===== FlyTo 目标 =====

export type FlyToTarget = GeoPoint | [number, number] | { layerId: string }

export interface FlyToOptions {
  duration?: number // 毫秒（2D）/ 秒（3D，内部转换）
  zoom?: number
  height?: number
  // Cesium 相机朝向（3D 专用；OL 忽略）
  heading?: number
  pitch?: number
  roll?: number
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
  // 大数量点图层聚合渲染（OL Cluster，默认关闭走视口裁剪）
  cluster?: boolean
  // 栅格图层透明度（GeoTIFF hillshade 等，0-1）
  opacity?: number
  // GeoJSON 图层 per-feature 样式回调（OL 渲染器消费）
  style?: unknown
  // GeoJSON 图层加载失败回调（Cesium 渲染器消费）
  onError?: (err: unknown) => void
  // ── 热力图选项（2D Only）──
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
 * 水面效果能力接口（3D Only）：3D 专有方法收敛为独立能力接口，仅 CesiumRenderer 实现，
 * 调用方先做能力检查，不支持的渲染器跳过并 warn。呼吸动画为双引擎公共能力，留在主接口。
 */
export interface Water3DCapability {
  addWaterSurface(
    id: string,
    coordinates: [number, number][],
    height: number,
    options?: WaterSurfaceOptions
  ): Promise<boolean>
  updateWaterLevel(id: string, newHeight: number): boolean
  removeWaterSurface(id: string): boolean
  removeAllWaterSurfaces(): boolean
  setWaterSurfaceVisibility(id: string, visible: boolean): boolean
}

// ===== 渲染器可选能力接口 =====
// 单引擎专有方法收敛为能力接口（避免基类为 2D 背负 3D 契约），调用方经类型守卫检查后调用；
// 守卫函数位于 core/map/layerAdapters.ts（types 层不引 core，避免循环依赖）

/** GeoTIFF 栅格图层能力（2D COG / 3D hillshade 影像——双引擎各自实现） */
export interface GeoTIFFCapability {
  addGeoTIFFLayer(id: string, url: string, options?: LayerOptions): boolean
}

/** 热力图能力（2D Only——OL 专属，Cesium 无对应实现） */
export interface HeatmapCapability {
  addHeatmapLayer(id: string, features: PointFeature[], options?: LayerOptions): boolean
  updateHeatmapLayer(id: string, features: PointFeature[], options?: LayerOptions): boolean
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

/** 渲染器导出状态（图层 ID → { visible }，特殊键 `_camera` 存切换用视角） */
export interface RendererState {
  [layerId: string]: { visible: boolean } | CameraState
}

// ===== 事件 =====

export interface MapRendererEventMap {
  /** 点击事件：命中要素的类型/属性/坐标，未命中为 null */
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
  /** 销毁地图，释放资源 */
  destroy(): void

  /** 添加点图层 */
  addPointLayer(_id: string, _features: PointFeature[], _options?: LayerOptions): void

  /** 添加多边形图层 */
  addPolygonLayer(_id: string, _features: PolygonFeature[], _options?: LayerOptions): void

  /** 添加 GeoJSON 图层 */
  addGeoJsonLayer(_id: string, _geojson: FeatureCollection, _options?: LayerOptions): void

  // addGeoTIFFLayer/addHeatmapLayer 等单引擎专有方法已收敛为上方能力接口，经类型守卫后调用

  /** 设置图层显隐 */
  setVisibility(_id: string, _visible: boolean): void

  /** 切换底图（image 影像 / vector 矢量）——双引擎公共能力 */
  setBaseLayer(_type: 'image' | 'vector'): void

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

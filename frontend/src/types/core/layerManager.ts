/**
 * 业务图层管理器（BLM）的类型元数据：LayerMeta 复用 LayerOptions（不另起样式类型），
 * data 保持 unknown 由 adapter 按业务契约收窄；LayerType 与 LAYER_ADAPTERS 注册表 key 对齐。
 */

import type { LayerOptions } from '@/types/renderer'

/** 业务图层类型，对应 LAYER_ADAPTERS 注册表 key（改这里 = 改图层能力清单） */
export type LayerType = 'heatmap' | 'geojson' | 'points' | 'polygon' | 'waterSurface' | 'geotiff'

/** 业务图层元数据（BusinessLayerManager._registry 条目形状，供 updateData/getMeta 复用） */
export interface LayerMeta {
  /** 图层唯一键（业务模块约定，如 "forecast-throughput"） */
  key: string
  /** LayerControlPanel 显示名 */
  label: string
  /** 图层类型，决定分派到哪个 adapter */
  layerType: LayerType
  /** 样式参数 —— 直接复用渲染器 LayerOptions */
  options: LayerOptions
  /** 业务数据负载：保持 unknown，形状由对应 adapter 内部收窄（manager 只搬运不解读） */
  data: unknown
  /** 初始 / 当前可见性 */
  visible: boolean
}

/** 需要更丰富样式时扩展 LayerOptions，勿另起一套，避免类型漂移 */

/** 水面图层数据载荷（3D Only，waterSurface adapter 入参，业务层构造 payload 时复用） */
export interface WaterSurfaceData {
  /** 水面边界多边形坐标环（[lng, lat][]） */
  coordinates: [number, number][]
  /** 水面高程（米） */
  height: number
}

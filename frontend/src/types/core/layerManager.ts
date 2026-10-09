/**
 * 业务图层管理器（BLM）的类型元数据：data 保持 unknown 由 adapter 按业务契约收窄；
 * LayerType 与 LAYER_ADAPTERS 注册表 key 对齐。
 */

/** 业务图层类型，对应 LAYER_ADAPTERS 注册表 key（改这里 = 改图层能力清单） */
export type LayerType =
  | 'heatmap'
  | 'geojson'
  | 'points'
  | 'polygon'
  | 'waterSurface'
  | 'geotiff'
  | '3dtiles'
  | 'imageOverlay'
  | 'terrain'

/** 水面图层数据载荷（3D Only，waterSurface adapter 入参，业务层构造 payload 时复用） */
export interface WaterSurfaceData {
  /** 水面边界多边形坐标环（[lng, lat][]） */
  coordinates: [number, number][]
  /** 水面高程（米） */
  height: number
}

/** 3D Tiles 图层数据载荷（3D Only，3dtiles adapter 入参） */
export interface Tiles3DData {
  /** tileset.json 地址（同源路径，如 /static/pinglu/tiles/tileset.json） */
  url: string
  /**
  /**
   * 瓦片集最大屏误差（像素）：越小越清晰、加载越多。
   * 缺省交给 Cesium 默认值 16；大场景可调到 32 换取更少瓦片。
   */
  maximumScreenSpaceError?: number
}

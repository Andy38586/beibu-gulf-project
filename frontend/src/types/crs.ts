/**
 * 坐标参考系统类型：业务数据统一 EPSG:4326（WGS84，与国标 CGCS2000 在 web 地图精度下可互换），
 * 渲染层由 OL/Cesium 内部投影到 EPSG:3857，前端不直接做投影运算；字段统一 lng/lat。
 * 本文件为纯类型层，运行时常量/工具在 shared/utils/crs.ts。
 */

/** 支持的坐标参考系统 */
export type CRS = 'EPSG:4326' | 'EPSG:4490' | 'EPSG:3857' | 'EPSG:4547'

/** 带 CRS 泛型的地理坐标点（默认 EPSG:4326） */
export interface GeoPoint<T extends CRS = 'EPSG:4326'> {
  lng: number
  lat: number
  crs?: T
}

/** 宽松坐标点：兼容历史数据 lon/lng/longitude 字段混用，仅数据入口归一化使用 */
export interface LaxPoint {
  lng?: number
  lat?: number
  lon?: number
  longitude?: number
  latitude?: number
  crs?: CRS
}

/**
 * 坐标参考系统（CRS）类型定义
 * 项目约定：
 * - 业务数据统一使用 EPSG:4326（WGS84）地理坐标系
 * - 北部湾港口数据按国标应使用 CGCS2000（EPSG:4490），与 WGS84 在 web 地图精度下可互换
 * - 渲染层由 OpenLayers/Cesium 内部投影到 EPSG:3857（Web Mercator）
 * - 前端不直接做投影运算，仅声明 CRS 并在数据入口校验
 * 字段名约定：全项目统一使用 lng/lat（不用 lon/longitude）
 *
 * 分层说明（架构审查收口）：本文件为**纯类型层**,零运行时依赖。
 * 运行时常量/工具（DEFAULT_CRS / normalizePoint / isInBeibuGulf 等）已移至
 * `shared/utils/crs.ts`,调用方从 @/shared 取。
 */

/** 支持的坐标参考系统 */
export type CRS = 'EPSG:4326' | 'EPSG:4490' | 'EPSG:3857' | 'EPSG:4547'

/**
 * 带类型的地理坐标点
 * @example
 * const p: GeoPoint<'EPSG:4326'> = { lng: 108.5, lat: 21.9, crs: 'EPSG:4326' }
 */
export interface GeoPoint<T extends CRS = 'EPSG:4326'> {
  lng: number
  lat: number
  crs?: T
}

/**
 * 宽松坐标点：兼容历史数据中 lon/lng/longitude 字段名混用的情况
 * 仅用于数据入口归一化（shared/utils/crs.ts 的 normalizePoint）,业务代码不应直接使用
 */
export interface LaxPoint {
  lng?: number
  lat?: number
  lon?: number
  longitude?: number
  latitude?: number
  crs?: CRS
}

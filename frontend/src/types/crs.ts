/**
 * 坐标参考系统类型（坐标系纪律 2026-09-08，数据平面大换代）：
 *   业务流通坐标唯一标准 = EPSG:4326（WGS84，与国标 CGCS2000 在 web 地图精度下可互换）；
 *   渲染层由 OL/Cesium 内部投影到 EPSG:3857，前端不直接做投影运算；
 *   EPSG:4490（CGCS2000 存储）与 EPSG:4547（高斯投影）仅限数据库存储层 / SQL / 导入工具，
 *   一经出口必须执行 ST_Transform(4326)，禁止进入业务流通（运行时由 shared/utils/crs 的 normalizePoint 硬守卫兜底）。
 * 字段统一 lng/lat。本文件为纯类型层，运行时常量/工具在 shared/utils/crs.ts。
 */

/** 支持的坐标参考系统（业务流通仅 'EPSG:4326'；其余仅供渲染内部/存储/工具层声明） */
export type CRS = 'EPSG:4326' | 'EPSG:4490' | 'EPSG:3857' | 'EPSG:4547'

/** 业务流通唯一允许的 CRS（渲染器内部 3857 由渲染层 private 使用，业务侧不感知） */
export type BusinessCRS = 'EPSG:4326'

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

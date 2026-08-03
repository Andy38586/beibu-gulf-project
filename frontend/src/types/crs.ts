/**
 * 坐标参考系统（CRS）类型定义
 *
 * 项目约定：
 * - 业务数据统一使用 EPSG:4326（WGS84）地理坐标系
 * - 北部湾港口数据按国标应使用 CGCS2000（EPSG:4490），与 WGS84 在 web 地图精度下可互换
 * - 渲染层由 OpenLayers/Cesium 内部投影到 EPSG:3857（Web Mercator）
 * - 前端不直接做投影运算，仅声明 CRS 并在数据入口校验
 *
 * 字段名约定：全项目统一使用 lng/lat（不用 lon/longitude）
 */

import { logger } from '@/shared'

/** 支持的坐标参考系统 */
export type CRS = 'EPSG:4326' | 'EPSG:4490' | 'EPSG:3857' | 'EPSG:4547'

/** 默认 CRS：业务数据统一使用 WGS84 */
export const DEFAULT_CRS: CRS = 'EPSG:4326'

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
 * 仅用于数据入口归一化，业务代码不应直接使用
 */
export interface LaxPoint {
  lng?: number
  lat?: number
  lon?: number
  longitude?: number
  latitude?: number
  crs?: CRS
}

/**
 * 将宽松坐标点归一化为标准 GeoPoint
 * 优先级：lng > lon > longitude；lat > latitude
 * 缺失值默认 0（避免 OL/Cesium 渲染崩溃），并在 dev 模式告警
 *
 * @example
 * const p = normalizePoint(facility)  // facility 可能是 { longitude, latitude }
 * if (p.crs && p.crs !== DEFAULT_CRS) {
 *   throw new Error(`不支持的 CRS: ${p.crs}`)
 * }
 */
export function normalizePoint(input: LaxPoint): GeoPoint<CRS> {
  const lng = input.lng ?? input.lon ?? input.longitude
  const lat = input.lat ?? input.latitude

  if (lng === undefined || lat === undefined) {
    logger.debug('[crs] 坐标字段缺失，已回退为 0,0:', input)
  }

  // 运行时 CRS 校验：如果声明了非默认 CRS，dev 模式告警
  if (input.crs && input.crs !== DEFAULT_CRS && input.crs !== 'EPSG:4490') {
    logger.debug(
      `[crs] 数据 CRS 为 ${input.crs}，渲染层按 ${DEFAULT_CRS} 处理。CGCS2000(4490) 与 WGS84(4326) 在 web 地图精度下可互换。`
    )
  }

  return {
    lng: lng ?? 0,
    lat: lat ?? 0,
    crs: input.crs,
  }
}

/**
 * 校验点的 CRS 是否符合预期
 * @throws {Error} 如果 CRS 不匹配且不是默认的 4326
 */
export function assertCRS(point: GeoPoint, expected: CRS = DEFAULT_CRS): void {
  if (point.crs && point.crs !== expected) {
    throw new Error(
      `CRS 不匹配: 期望 ${expected}，实际 ${point.crs}。` +
        `北部湾港口数据应统一使用 EPSG:4326（WGS84）或 EPSG:4490（CGCS2000）。`
    )
  }
}

/**
 * 北部湾业务区域边界（EPSG:4326）
 * 用于数据入口校验，过滤明显越界的异常坐标
 */
export const BEIBU_GULF_BBOX = {
  minLng: 105.0,
  maxLng: 112.0,
  minLat: 18.0,
  maxLat: 23.5,
} as const

/**
 * 校验坐标点是否在北部湾业务区域内
 * @returns true 如果在区域内
 */
export function isInBeibuGulf(point: GeoPoint): boolean {
  return (
    point.lng >= BEIBU_GULF_BBOX.minLng &&
    point.lng <= BEIBU_GULF_BBOX.maxLng &&
    point.lat >= BEIBU_GULF_BBOX.minLat &&
    point.lat <= BEIBU_GULF_BBOX.maxLat
  )
}

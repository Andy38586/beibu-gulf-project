/**
 * CRS 运行时常量与工具：从 types/crs 移入 shared，保持 types 为纯类型层
 * （原 types 混入运行时逻辑并反向依赖 shared，违反分层）。
 *
 * 坐标系纪律（2026-09-08 数据平面大换代固化）：
 *   应用层流通坐标恒为 EPSG:4326（84）；渲染器（OL/Cesium）内部按 EPSG:3857 处理，
 *   对外经 fromLonLat/toLonLat 转换；EPSG:4490/4547 仅用于数据库存储层与 SQL/导入工具，
 *   一经出口必须转 4326（如 site-analysis repository 的 ST_Transform），禁止进入业务流通。
 */
import type { CRS, GeoPoint, LaxPoint } from '@/types/crs'

import { logger } from './logger'

/** 默认 CRS：业务数据统一使用 WGS84 */
export const DEFAULT_CRS: CRS = 'EPSG:4326'

/**
 * 归一化宽松坐标点为标准 GeoPoint（优先级 lng > lon > longitude）。
 * 坐标字段缺失时返回 null 并 dev 告警——调用方应跳过该要素（skip），
 * 不再回退 (0,0) 哨兵（哨兵点会被渲染到几内亚湾，是数据缺陷的掩盖）。
 */
export function normalizePoint(input: LaxPoint): GeoPoint<CRS> | null {
  const lng = input.lng ?? input.lon ?? input.longitude
  const lat = input.lat ?? input.latitude

  if (lng === undefined || lat === undefined) {
    logger.debug('[crs] 坐标字段缺失，已跳过该要素:', input)
    return null
  }

  // 运行时 CRS 硬守卫：声明的非 84 坐标系一律拒绝进入流通（含 4490/3857/4547）。
  // 数据必须先在出口转成 4326 再来（渲染层 3857 是 OL/Cesium 内部处理，业务侧不感知）。
  if (input.crs && input.crs !== DEFAULT_CRS) {
    logger.warn(
      `[crs] 拒绝非 84 坐标进入流通：疑似 crs=${input.crs}，坐标系纪律要求流通前先转 4326，已跳过该要素`
    )
    return null
  }

  return {
    lng,
    lat,
    crs: input.crs,
  }
}

/** 北部湾业务区域边界（EPSG:4326），用于数据入口校验、过滤明显越界的异常坐标。
 *  与后端 siteAnalysisService.js 同源（后端权威，8-8 统一：原 112/23.5 收紧于后端 115/25） */
export const BEIBU_GULF_BBOX = {
  minLng: 105.0,
  maxLng: 115.0,
  minLat: 18.0,
  maxLat: 25.0,
} as const

/** 校验坐标点是否在北部湾业务区域内 */
export function isInBeibuGulf(point: GeoPoint): boolean {
  return (
    point.lng >= BEIBU_GULF_BBOX.minLng &&
    point.lng <= BEIBU_GULF_BBOX.maxLng &&
    point.lat >= BEIBU_GULF_BBOX.minLat &&
    point.lat <= BEIBU_GULF_BBOX.maxLat
  )
}

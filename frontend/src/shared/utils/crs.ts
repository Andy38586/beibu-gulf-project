/**
 * CRS 运行时常量与工具：从 types/crs 移入 shared，保持 types 为纯类型层
 * （原 types 混入运行时逻辑并反向依赖 shared，违反分层）。
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

  // 运行时 CRS 校验：如果声明了非默认 CRS，dev 模式告警
  if (input.crs && input.crs !== DEFAULT_CRS && input.crs !== 'EPSG:4490') {
    logger.debug(
      `[crs] 数据 CRS 为 ${input.crs}，渲染层按 ${DEFAULT_CRS} 处理。CGCS2000(4490) 与 WGS84(4326) 在 web 地图精度下可互换。`
    )
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

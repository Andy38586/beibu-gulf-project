import { Injectable } from '@nestjs/common'

import { isInGulfBounds } from '../../../common/constants/gis.constants'
import { DEFAULT_WEIGHTS, TOP_N } from '../../../common/constants/scoring.constants'
import { BusinessError, ErrorCode } from '../../../common/errors/business-error'
import { GeoJsonFeature, SpatialRepository } from '../../../infra/db/spatial.repository'

import { FacilityPoint, importanceToRadius, linearDecay, scoreXiaoqu, TypeSetting } from './scoring'
import { createSpatialIndex, queryByBBox } from './spatial-index'

// 逐行等价移植 backend/services/siteAnalysisService.js（九步选址计算）。
// 空间算子（buffer/union/intersect/点面判定）已下沉 PostGIS，评分（距离衰减/加权/排名）
// 留在 Node——见 infra/db/spatial.repository.ts 的口径对齐表。
//
// 历史注：旧实现用 turf.buffer(steps=2) + unionDivide 分治合并。分治是为了绕开
// turf.union「累积结果 vs 下一个缓冲区」逐个合并的顶点数退化（北海 mall 796→295 顶点、
// 6 类合计 7793→1491ms）。PostGIS 的 ST_Union 聚合是 GEOS 级联并集，天然无此退化，
// 同样的最坏项实测再降一个量级（qz/bus_station 723ms→34ms），分治逻辑随之删除。

export interface SiteAnalysisInput {
  selectedKeys: string[]
  typeSettings: Record<string, TypeSetting>
  facilityData: Record<string, FacilityPoint[] | null | undefined>
  xiaoquData: FacilityPoint[]
  weights?: Record<string, number> | null
}

export interface SiteAnalysisResult {
  error: string | null
  empty?: boolean
  emptyReason?: string
  coverage: unknown
  matchedXiaoqu: Array<Record<string, unknown>>
  facilityPoi: Record<string, FacilityPoint[]>
}

export type Coverage = GeoJsonFeature | null

export function validateSelection(selectedKeys: string[] | null | undefined): string | null {
  if (!selectedKeys || selectedKeys.length === 0) {
    return '请至少选择一种设施类型'
  }
  return null
}

export function resolveRadiusSettings(
  selectedKeys: string[],
  typeSettings: Record<string, TypeSetting>
): Record<string, { selected: boolean; radius: number }> {
  const resolved: Record<string, { selected: boolean; radius: number }> = {}
  selectedKeys.forEach((key) => {
    const setting = typeSettings[key]
    // 防御键集不一致：API 公开，异常请求可能缺键，缺键抛业务错误而非 TypeError
    if (!setting || typeof setting !== 'object') {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, `设施类型 ${key} 缺少 typeSettings 配置`)
    }
    const radius = importanceToRadius(setting.defaultRadius as number, setting.importance)

    // 校验半径必须为正数
    if (radius <= 0 || Number.isNaN(radius)) {
      // 参数错误带码抛出，控制器据码返 400
      throw new BusinessError(ErrorCode.INVALID_PARAMS, `半径参数无效: ${radius}`)
    }

    resolved[key] = { selected: true, radius }
  })
  return resolved
}

/**
 * 提取参与评分的合法 POI：坐标去重 + 有效性过滤 + 北部湾业务区域过滤。
 * 与 buildTypeCoverage 的入参清洗同源——评分链路消费哪些点，facilityPoi 就返回哪些点
 */
export function extractValidPoi<T extends FacilityPoint>(points: T[] | null | undefined): T[] {
  if (!points || points.length === 0) return []

  // POI数据去重（基于坐标）
  const uniquePoints: T[] = []
  const seenCoords = new Set<string>()
  for (const p of points) {
    const coordKey = `${p.lng},${p.lat}`
    if (!seenCoords.has(coordKey)) {
      seenCoords.add(coordKey)
      uniquePoints.push(p)
    }
  }

  // 过滤异常坐标（[0,0]）与不在北部湾范围内的坐标（范围边界见 gis.constants）
  return uniquePoints.filter((p) => {
    const isValid =
      !!p &&
      typeof p.lng === 'number' &&
      typeof p.lat === 'number' &&
      !Number.isNaN(p.lng) &&
      !Number.isNaN(p.lat) &&
      !(p.lng === 0 && p.lat === 0) && // 过滤[0,0]异常坐标
      isInGulfBounds(p.lng, p.lat)
    return isValid
  })
}

/**
 * 单设施类型覆盖范围：合法 POI 逐个缓冲后取并集（PostGIS：ST_Buffer + ST_Union）。
 * 无有效点返回 null（调用方按"该类型覆盖缺失"处理）。
 */
export async function buildTypeCoverage(
  spatial: SpatialRepository,
  points: FacilityPoint[] | null | undefined,
  radiusKm: number
): Promise<Coverage> {
  const validPoints = extractValidPoi(points)
  return spatial.unionBuffers(validPoints, radiusKm)
}

/**
 * 多类型覆盖范围求交（两两串行，前一个结果作为下一个输入）。
 * 某一步无交集 → area=null 且 failKey 指向断裂类型（前端按"与某类型无重叠"提示）。
 */
export async function intersectCoverages(
  spatial: SpatialRepository,
  coverages: Coverage[],
  selectedKeys: string[]
): Promise<{ area: Coverage; failKey: string | null }> {
  const entries = coverages
    .map((c, i) => ({ key: selectedKeys[i], coverage: c }))
    .filter((e) => e.coverage && e.coverage.geometry)

  if (entries.length === 0) return { area: null, failKey: null }

  let result = entries[0].coverage as GeoJsonFeature

  for (let i = 1; i < entries.length; i++) {
    const next = entries[i].coverage as GeoJsonFeature

    // 验证输入几何对象
    if (!result?.geometry?.coordinates || !next?.geometry?.coordinates) {
      continue
    }

    const intersectResult = await spatial.intersect(result, next)

    if (!intersectResult || !intersectResult.geometry) {
      return { area: null, failKey: entries[i].key }
    }

    result = intersectResult
  }

  return { area: result, failKey: null }
}

/** 小区有效性：坐标有限 + 经纬度值域 + 北部湾业务区（边界见 gis.constants） */
function isValidXiaoqu(xq: FacilityPoint | null | undefined): boolean {
  if (!xq || typeof xq.lng !== 'number' || typeof xq.lat !== 'number') {
    return false
  }
  if (Number.isNaN(xq.lng) || Number.isNaN(xq.lat)) return false
  if (xq.lng < -180 || xq.lng > 180 || xq.lat < -90 || xq.lat > 90) {
    return false
  }
  // 检查坐标是否在北部湾业务区域内（边界见 gis.constants）
  return isInGulfBounds(xq.lng, xq.lat)
}

/**
 * 命中小区筛选：BBox 粗筛（rbush）→ 有效性过滤 → 点面精确判定（PostGIS ST_Covers）。
 * 粗筛只做超集裁剪，结果由库内判定决定，与旧实现逐点一致。
 */
export async function filterMatchedXiaoqu<T extends FacilityPoint>(
  spatial: SpatialRepository,
  xiaoquData: T[] | null | undefined,
  finalArea: Coverage,
  spatialIndex: ReturnType<typeof createSpatialIndex<T>> | null = null
): Promise<T[]> {
  // 检查 xiaoquData 是否为空或 null
  if (!xiaoquData || xiaoquData.length === 0) {
    return []
  }
  if (!finalArea?.geometry) {
    return []
  }

  const candidates = spatialIndex ? queryByBBox(spatialIndex, finalArea) : xiaoquData
  const valid = candidates.filter((xq) => isValidXiaoqu(xq))
  const hitIndices = await spatial.pointIndicesInGeometry(valid, finalArea.geometry)
  return hitIndices.map((i) => valid[i])
}

export function rankXiaoqu(
  matched: FacilityPoint[],
  facilityData: Record<string, FacilityPoint[] | null | undefined>,
  radiusSettings: Record<string, { selected: boolean; radius: number }>,
  weights: Record<string, number>
): Array<Record<string, unknown>> {
  const scored = scoreXiaoqu(matched, facilityData, radiusSettings, weights, linearDecay)
  return scored.sort((a, b) => (b.score as number) - (a.score as number)).slice(0, TOP_N)
}

@Injectable()
export class SiteAnalysisService {
  constructor(private readonly spatial: SpatialRepository) {}

  async runSiteAnalysis({
    selectedKeys,
    typeSettings,
    facilityData,
    xiaoquData,
    weights,
  }: SiteAnalysisInput): Promise<SiteAnalysisResult> {
    // null 不会触发默认参数，需显式处理
    const finalWeights = weights || DEFAULT_WEIGHTS
    const validationError = validateSelection(selectedKeys)
    if (validationError) {
      return { error: validationError, coverage: null, matchedXiaoqu: [], facilityPoi: {} }
    }

    const radiusSettings = resolveRadiusSettings(selectedKeys, typeSettings)

    // 各类型覆盖互不依赖 → 并发下发 SQL；单连接串行会白白叠加 RTT
    const coverages = await Promise.all(
      selectedKeys.map((key) =>
        buildTypeCoverage(this.spatial, facilityData[key], radiusSettings[key].radius)
      )
    )

    const { area: finalArea, failKey } = await intersectCoverages(
      this.spatial,
      coverages,
      selectedKeys
    )
    if (!finalArea) {
      // 8-1：无重叠是合法空结果（02 §4.1 应然），不是错误信封——用 empty 标记而非 error 字段，
      // 避免 controller 将其转 422；前端按业务空结果展示"无重叠区域"提示。
      // 文案区分两种空：全部类型无覆盖（failKey=null）≠ 交集在某类型处断裂
      const emptyReason =
        failKey === null
          ? '所选设施类型的覆盖数据均不可用，请检查数据或调整类型'
          : `${failKey} 的覆盖范围与其他类型无重叠区域`
      return {
        error: null,
        empty: true,
        emptyReason,
        coverage: null,
        matchedXiaoqu: [],
        facilityPoi: {},
      }
    }
    const spatialIndex = createSpatialIndex(xiaoquData)
    const matched = await filterMatchedXiaoqu(this.spatial, xiaoquData, finalArea, spatialIndex)
    const top = rankXiaoqu(matched, facilityData, radiusSettings, finalWeights)

    // facilityPoi = 参与评分的合法 POI（与覆盖计算入参同源）：前端按设施类型渲染 POI 图层
    const facilityPoi: Record<string, FacilityPoint[]> = {}
    selectedKeys.forEach((key) => {
      facilityPoi[key] = extractValidPoi(facilityData[key])
    })

    return { error: null, coverage: finalArea, matchedXiaoqu: top, facilityPoi }
  }
}

import { Injectable } from '@nestjs/common'
import * as turf from '@turf/turf'
import type { Feature, MultiPolygon, Polygon } from 'geojson'

import { DEFAULT_WEIGHTS, TOP_N } from '../../common/constants/scoring.constants'
import { BusinessError, ErrorCode } from '../../common/errors/business-error'

import { FacilityPoint, importanceToRadius, linearDecay, scoreXiaoqu, TypeSetting } from './scoring'
import { createSpatialIndex, queryByPolygon } from './spatial-index'

// 逐行等价移植 backend/services/siteAnalysisService.js（九步选址计算）

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

// turf 未导出 Feature 类型（7.3.5），几何类型直接取 @types/geojson
type GeoFeature = Feature<Polygon | MultiPolygon>
type Coverage = { geometry?: { type?: string; coordinates?: unknown } | null } | null

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

  // 过滤异常坐标[0,0]和不在北部湾范围内的坐标
  // 北部湾范围：经度 105-115，纬度 18-25
  return uniquePoints.filter((p) => {
    const isValid =
      !!p &&
      typeof p.lng === 'number' &&
      typeof p.lat === 'number' &&
      !Number.isNaN(p.lng) &&
      !Number.isNaN(p.lat) &&
      !(p.lng === 0 && p.lat === 0) && // 过滤[0,0]异常坐标
      p.lng >= 105 &&
      p.lng <= 115 && // 北部湾经度范围
      p.lat >= 18 &&
      p.lat <= 25 // 北部湾纬度范围
    return isValid
  })
}

/**
 * 分治合并缓冲区。
 * turf.union(featureCollection) 是"累积结果 vs 下一个缓冲区"逐个合并，代价随累积多边形
 * 顶点数退化——设施密集、缓冲重叠多时中间结果会非常巨大。分治让每一步合并的规模都小。
 * 实测 6 类合计（tools/perf-bench/coverage-opt-by-city.mjs）：
 *   钦州 2320→1568ms(1.48x) / 北海 7793→1491ms(5.23x，mall 单项 6359→357ms) / 防城港 1714→705ms(2.43x)
 * 且输出顶点更少（北海 mall 796→295），前端渲染同步受益。
 */
function unionDivide(features: GeoFeature[]): GeoFeature | null {
  if (features.length === 1) return features[0]
  const mid = Math.floor(features.length / 2)
  const left = unionDivide(features.slice(0, mid))
  const right = unionDivide(features.slice(mid))
  if (!left || !left.geometry) return right
  if (!right || !right.geometry) return left
  try {
    return turf.union(turf.featureCollection([left, right]))
  } catch {
    // 降级：返回已合并的半边，宁可覆盖范围偏小也不中断整个选址流程
    return left
  }
}

export function buildTypeCoverage(
  points: FacilityPoint[] | null | undefined,
  radiusKm: number
): Coverage {
  const validPoints = extractValidPoi(points)
  if (validPoints.length === 0) {
    return null
  }

  // steps=2 降低缓冲区离散精度（每圆 8 顶点而非 ~33）。覆盖多边形用于可视化与点面判定，
  // 八边形逼近在 0.5~3km 尺度上肉眼无差，但顶点数降至约 1/3，直接压低后续 union 成本。
  const buffers = validPoints.map((p) =>
    turf.buffer(turf.point([p.lng, p.lat]), radiusKm, { units: 'kilometers', steps: 2 })
  )

  // 过滤掉无效的缓冲区
  const validBuffers = buffers.filter(
    (b) => b && b.geometry && b.geometry.coordinates && b.geometry.coordinates.length > 0
  )
  if (validBuffers.length === 0) {
    return null
  }

  if (validBuffers.length === 1) return validBuffers[0] as Coverage

  try {
    const unionResult = unionDivide(validBuffers as GeoFeature[])
    // 验证 union 结果，处理 MultiPolygon 情况
    if (!unionResult || !unionResult.geometry) {
      return null
    }
    // MultiPolygon 保留完整结果（不截断为第一个 Polygon）
    return unionResult as Coverage
  } catch {
    // 降级契约：union 异常返回 null——调用方对 null 视为"该类型覆盖缺失"走空覆盖分支，
    // 不中断整个选址流程（intersectCoverages 同样容忍 null）
    return null
  }
}

export function intersectCoverages(
  coverages: Coverage[],
  selectedKeys: string[]
): { area: Coverage; failKey: string | null } {
  const entries = coverages
    .map((c, i) => ({ key: selectedKeys[i], coverage: c }))
    .filter((e) => e.coverage && e.coverage.geometry)

  if (entries.length === 0) return { area: null, failKey: null }

  let result: Coverage = entries[0].coverage

  for (let i = 1; i < entries.length; i++) {
    try {
      // 验证输入几何对象
      if (!result?.geometry?.coordinates || !entries[i].coverage?.geometry?.coordinates) {
        continue
      }

      const intersectResult = turf.intersect(
        turf.featureCollection([
          result as unknown as GeoFeature,
          entries[i].coverage as unknown as GeoFeature,
        ])
      )

      if (!intersectResult || !intersectResult.geometry) {
        return { area: null, failKey: entries[i].key }
      }

      result = intersectResult as Coverage
    } catch {
      return { area: null, failKey: entries[i].key }
    }
  }

  return { area: result, failKey: null }
}

export function filterMatchedXiaoqu<T extends FacilityPoint>(
  xiaoquData: T[] | null | undefined,
  finalArea: Coverage,
  spatialIndex: ReturnType<typeof createSpatialIndex<T>> | null = null
): T[] {
  // 检查 xiaoquData 是否为空或 null
  if (!xiaoquData || xiaoquData.length === 0) {
    return []
  }

  const candidates = spatialIndex
    ? queryByPolygon(spatialIndex, finalArea as GeoFeature)
    : xiaoquData

  // 验证 GeoJSON Feature 完整性
  return candidates.filter((xq) => {
    // 检查必要字段
    if (!xq || typeof xq.lng !== 'number' || typeof xq.lat !== 'number') {
      return false
    }
    // 检查坐标有效性
    if (
      Number.isNaN(xq.lng) ||
      Number.isNaN(xq.lat) ||
      xq.lng < -180 ||
      xq.lng > 180 ||
      xq.lat < -90 ||
      xq.lat > 90
    ) {
      return false
    }
    // 检查坐标是否在北部湾业务区域内（经度 105-115，纬度 18-25）
    if (xq.lng < 105 || xq.lng > 115 || xq.lat < 18 || xq.lat > 25) {
      return false
    }
    try {
      return turf.booleanPointInPolygon(turf.point([xq.lng, xq.lat]), finalArea as GeoFeature)
    } catch {
      return false
    }
  })
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
  runSiteAnalysis({
    selectedKeys,
    typeSettings,
    facilityData,
    xiaoquData,
    weights,
  }: SiteAnalysisInput): SiteAnalysisResult {
    // null 不会触发默认参数，需显式处理
    const finalWeights = weights || DEFAULT_WEIGHTS
    const validationError = validateSelection(selectedKeys)
    if (validationError) {
      return { error: validationError, coverage: null, matchedXiaoqu: [], facilityPoi: {} }
    }

    const radiusSettings = resolveRadiusSettings(selectedKeys, typeSettings)

    const coverages = selectedKeys.map((key) =>
      buildTypeCoverage(facilityData[key], radiusSettings[key].radius)
    )

    const { area: finalArea, failKey } = intersectCoverages(coverages, selectedKeys)
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
    const matched = filterMatchedXiaoqu(xiaoquData, finalArea, spatialIndex)
    const top = rankXiaoqu(matched, facilityData, radiusSettings, finalWeights)

    // facilityPoi = 参与评分的合法 POI（与覆盖计算入参同源）：前端按设施类型渲染 POI 图层
    const facilityPoi: Record<string, FacilityPoint[]> = {}
    selectedKeys.forEach((key) => {
      facilityPoi[key] = extractValidPoi(facilityData[key])
    })

    return { error: null, coverage: finalArea, matchedXiaoqu: top, facilityPoi }
  }
}

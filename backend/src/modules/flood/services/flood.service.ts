import { Injectable } from '@nestjs/common'

import {
  deriveRiskLevel,
  deriveRiskLevelCode,
  MAX_WATER_LEVEL,
  RISK_LEVEL_BANDS,
} from '../../../common/constants/flood.constants'
import { BusinessError, ErrorCode } from '../../../common/errors/business-error'
import { GeoJsonGeometry, SpatialRepository } from '../../../infra/db/spatial.repository'
import { FloodLevelFeatureRow, FloodRepository } from '../repositories/flood.repository'

// 洪涝业务层（逐行等价移植 backend/services/floodService.js）：
// 读编排（取档/风险注入/基准偏移）与设施评估都在此层，controller 只做路由委托。
// 设施点与淹没多边形空间筛选（与 FastAPI compute_impact 同口径），损失 = value × damageRate；
// 空间筛选已下沉 PostGIS（ST_Covers），与 turf.booleanPointInPolygon 命中集合一致；
// 评分/损失加权留在 Node（业务口径不进 SQL）
export interface FloodFacility {
  id: string
  name: string
  type: string
  port: string
  lng: number
  lat: number
  elevation: number
  value: number
  damageRate: number
}

export interface FloodZoneFeature {
  /** GeoJSON Feature 固有字段（PostGIS 路径由本层组装，JSON 路径原样透传） */
  type?: string
  geometry?: GeoJsonGeometry | null
  properties?: Record<string, unknown>
}

export interface FloodZone {
  waterLevel: number
  riskLevel: string
  features?: FloodZoneFeature[]
}

export interface DisasterAssessment {
  affectedFacilities: Array<Record<string, unknown>>
  totalLoss: number
  riskLevel: string
  waterLevel: number | undefined
}

// 数据形状（backend/data/flood/*.json；repository 返回 unknown，此处声明消费视图）
// 注：原 FloodZoneEntry / FloodAreaData 已随 flood-areas 改接 PostGIS（251 档）而下线，
// 档位数据现由 FloodLevelFeatureRow[].rowsToZones 组装。readFloodArea 死方法与
// floodArea.json 已删（z154，2026-09-12）：切回 JSON 属回滚预案，届时从 git 历史恢复。

interface StatisticsEntry extends Record<string, unknown> {
  waterLevel: number
  /** 平均/最大水深：源数据只有 6 档 DEM 反演值（无 251 档水深），仅作参考档位数据 */
  averageDepth?: number
  maxDepth?: number
}

interface FloodStatisticsData {
  statistics: StatisticsEntry[]
}

interface TerrainProfileData {
  metadata?: { datumOffset?: number } | null
  profiles: Array<Record<string, unknown>>
}

interface WaterAreaData {
  coordinates?: number[][]
}

interface FacilityData {
  facilities: FloodFacility[]
}

/** 校验水位：有限数值且在 0–25 范围内，否则抛业务错误（parseFloat 语义对齐 Express） */
function validateWaterLevel(raw: unknown): number {
  const level = parseFloat(raw as string)
  if (!Number.isFinite(level) || level < 0 || level > MAX_WATER_LEVEL) {
    throw new BusinessError(
      ErrorCode.INVALID_PARAMS,
      `水位参数无效（需 0–${MAX_WATER_LEVEL} 的有限数值）`
    )
  }
  return level
}

/**
 * 6 档参考表向上取档：返回 >= 请求水位的最低档位；超档（15 < 水位 ≤ 25）取最高档兜底。
 * 2026-09-11 后仅用于 floodStatistics.json 参考表（水深参考档位），档位/面积/设施判定
 * 一律不再经此函数（见 getFloodStatistics 注释）。
 */
function pickZone<T extends { waterLevel: number }>(zones: T[], level: number): T | undefined {
  return (
    zones.find((zone) => zone.waterLevel >= level) ??
    (zones.length ? zones.reduce((max, z) => (z.waterLevel > max.waterLevel ? z : max)) : undefined)
  )
}

@Injectable()
export class FloodService {
  constructor(
    private readonly floodRepository: FloodRepository,
    private readonly spatial: SpatialRepository
  ) {}

  /**
   * GET /flood-areas?waterLevel=2.5 — 淹没范围数据。
   * 指定水位：PostGIS `flood_levels`（251 档，0.1m 步长）向上取档。此前读 floodArea.json
   * 仅 6 档（0/2/5/8/10/15），精度退化原因见 repository 注释。
   * 未指定：返回全部档位（兼容保留，前端恒传 waterLevel）。
   */
  async getFloodAreas(waterLevel?: string): Promise<unknown> {
    if (waterLevel !== undefined) {
      const level = validateWaterLevel(waterLevel)
      const rows = await this.floodRepository.pickFloodLevel(level)

      // 表为空（未灌数）的防御兜底；正常路径不可达（请求 0-25 均有档位可取）
      if (rows.length === 0) {
        return {
          waterLevel: level,
          requestedWaterLevel: level,
          actualWaterLevel: level,
          riskLevel: RISK_LEVEL_BANDS[0].label,
          features: [],
        }
      }

      return this.rowsToZoneResponse(rows, level)
    }

    // 未指定水位，返回所有淹没范围（按档位分组，保持原 JSON 契约形状）
    return this.rowsToZones(await this.floodRepository.listFloodLevels())
  }

  /**
   * 单档响应组装（指定水位路径）。
   * riskLevel 由 deriveRiskLevel 按实际档位派生——该函数自 flood.constants.ts 起即为
   * 「预计算档位表无 riskLevel 字段，由水位分段派生」而写，此前因表在 Python 侧从未接通；
   * 251 档下不可能每档存 riskLevel（仅 6 种取值），派生是唯一无冗余解。
   */
  private rowsToZoneResponse(rows: FloodLevelFeatureRow[], requestedLevel: number): unknown {
    const actualLevel = Number(rows[0].level)
    const riskLevel = deriveRiskLevel(actualLevel)
    return {
      waterLevel: actualLevel,
      // 显式区分请求水位与实际数据档位（向上取档时 actual > requested，前端可感知）
      requestedWaterLevel: requestedLevel,
      actualWaterLevel: actualLevel,
      riskLevel,
      // 后端权威注入 riskLevel，满足前端 FloodFeature 类型契约，前端无需再补映射层
      features: this.rowsToFeatures(rows, riskLevel),
    }
  }

  /** 全档位响应组装（未指定水位路径） */
  private rowsToZones(rows: FloodLevelFeatureRow[]): FloodZone[] {
    const byLevel = new Map<number, FloodLevelFeatureRow[]>()
    for (const row of rows) {
      const lv = Number(row.level)
      const list = byLevel.get(lv)
      if (list) list.push(row)
      else byLevel.set(lv, [row])
    }
    return [...byLevel.entries()].map(([lv, group]) => {
      const riskLevel = deriveRiskLevel(lv)
      return { waterLevel: lv, riskLevel, features: this.rowsToFeatures(group, riskLevel) }
    })
  }

  /** 多边形行 → GeoJSON Feature 数组（geometry 为 NULL 的档位行被过滤，即"档位存在但无淹没"） */
  private rowsToFeatures(rows: FloodLevelFeatureRow[], riskLevel: string): FloodZoneFeature[] {
    return rows
      .filter((row) => row.geometry !== null)
      .map((row) => ({
        type: 'Feature',
        geometry: JSON.parse(row.geometry as string) as GeoJsonGeometry,
        properties: { area: Number(row.area), riskLevel },
      }))
  }

  /**
   * GET /flood-statistics?waterLevel=2.5 — 统计数据。
   *
   * 2026-09-11 修复统计口径双轨：原实现读 floodStatistics.json（6 档参考表）并**向上取档**，
   * 于是请求 4.5 返回 5 档、请求 5.1 返回 8 档——面板面积/水深来自与地图不同的水位，
   * 且该文件生成于 SRID 修复之前（设施数恒 0、损失与 disaster 差两个数量级）。
   * 现改为与 flood-areas / analysis/disaster 同源：
   *   · 档位与淹没面积 → PostGIS flood_levels（251 档，flooded_km2 原值透传）
   *   · 风险等级/编码   → RISK_LEVEL_BANDS 分段派生（与 areas/disaster 同一函数）
   *   · 设施数/受影响港口/预估损失 → 与 disaster 同一次点面判定（ST_Covers）与同一损失口径
   *   · 平均/最大水深 → 仍取 6 档 DEM 反演参考表（源数据无 251 档水深），
   *     以 depthRefLevel 显式标注其所属档位，避免被读成当前水位的精确值
   * 未指定水位：返回 6 档参考表（兼容原契约；前端 floodAdapter 恒传 waterLevel）。
   */
  async getFloodStatistics(waterLevel?: string): Promise<unknown> {
    const reference = (await this.floodRepository.readFloodStatistics()) as FloodStatisticsData

    if (waterLevel === undefined) {
      return reference.statistics
    }

    const level = validateWaterLevel(waterLevel)
    const rows = await this.floodRepository.pickFloodLevel(level)

    // 表未灌数（正常路径不可达）：与 getFloodAreas 同口径的零值响应，不静默返 null
    if (rows.length === 0) {
      return {
        waterLevel: level,
        requestedWaterLevel: level,
        actualWaterLevel: level,
        riskLevel: RISK_LEVEL_BANDS[0].label,
        riskLevelCode: 0,
        floodArea: 0,
        averageDepth: 0,
        maxDepth: 0,
        depthRefLevel: level,
        affectedFacilityCount: 0,
        affectedPorts: [],
        estimatedLoss: 0,
      }
    }

    const zone = this.rowsToZones(rows)[0] ?? null
    const facilityData = (await this.floodRepository.readFacilityPoints()) as FacilityData
    const assessment = await this.assessDisaster(facilityData.facilities, level, zone)

    const actualLevel = Number(rows[0].level)
    const floodArea = Number(rows[0].flooded_km2)
    const depthRef = pickZone(reference.statistics, level)
    const affectedFacilityCount = assessment.affectedFacilities.length
    const affectedPorts = [
      ...new Set(assessment.affectedFacilities.map((f) => String(f.port ?? '')).filter(Boolean)),
    ]
    const depthNote =
      depthRef && depthRef.waterLevel !== actualLevel
        ? `；平均/最大水深为 ${depthRef.waterLevel}m 档 DEM 反演参考值`
        : ''

    return {
      waterLevel: actualLevel,
      requestedWaterLevel: level,
      actualWaterLevel: actualLevel,
      riskLevel: assessment.riskLevel,
      riskLevelCode: deriveRiskLevelCode(actualLevel),
      floodArea,
      averageDepth: depthRef?.averageDepth ?? 0,
      maxDepth: depthRef?.maxDepth ?? 0,
      // 水深所属参考档位（= waterLevel 时表示该水位有 DEM 反演水深）
      depthRefLevel: depthRef?.waterLevel ?? actualLevel,
      affectedFacilityCount,
      affectedPorts,
      // 与 disaster 同口径（value × damageRate）；单位万元——facilityPoints.json
      // metadata.valueUnit=万元，前端 formatLoss 亦按万元换算（亿/万）
      estimatedLoss: assessment.totalLoss,
      description: `水位 ${actualLevel}m 连通性演算：淹没 ${floodArea} km²，受影响设施 ${affectedFacilityCount} 处${depthNote}`,
    }
  }

  /**
   * GET /terrain-profiles — 剖面数据。
   * 垂直基准偏移：水位(理论深度基准面) - datumOffset = 剖面高程基准(EGM96 正高)。
   * 逐条 profile 透传，供水面线与地形同基准绘制。
   */
  async getTerrainProfiles(): Promise<unknown> {
    const data = (await this.floodRepository.readTerrainProfile()) as TerrainProfileData
    const datumOffset = data.metadata?.datumOffset ?? 0
    return data.profiles.map((p) => ({ ...p, datumOffset }))
  }

  /** GET /water-area — 水域边界坐标数组 [[lng, lat], ...]（与前端 floodAdapter.getWaterArea 消费形状一致） */
  async getWaterArea(): Promise<unknown> {
    const data = (await this.floodRepository.readWaterArea()) as WaterAreaData
    if (!Array.isArray(data?.coordinates) || data.coordinates.length === 0) {
      throw new BusinessError(ErrorCode.NOT_FOUND, '水域坐标数据缺失或格式无效')
    }
    return data.coordinates
  }

  /** POST /analysis/disaster — 灾害评估：读设施与淹没范围、取档后委托 assessDisaster。 */
  async analyzeDisaster(body?: { waterLevel?: unknown }): Promise<unknown> {
    const { waterLevel } = body ?? {}

    if (waterLevel === undefined) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '缺少水位参数')
    }

    const level = validateWaterLevel(waterLevel)

    // 读取设施数据；档位淹没范围取自 PostGIS（与 getFloodAreas 同口径，向上取档；
    // 超档回落到最高档，不静默空评估）
    const facilityData = (await this.floodRepository.readFacilityPoints()) as FacilityData
    const zones = this.rowsToZones(await this.floodRepository.pickFloodLevel(level))

    // pickFloodLevel 只返回选中档的多边形，故分组后至多一项；表为空 → null 走"无受影响设施"分支
    const floodZone: FloodZone | null = zones[0] ?? null

    // 点面判定在 PostGIS 内完成，故为异步
    const result = await this.assessDisaster(facilityData.facilities, level, floodZone)

    return {
      // 返回实际档位水位，消除请求值与实际档位的错配
      waterLevel: result.waterLevel,
      requestedWaterLevel: level,
      riskLevel: result.riskLevel,
      affectedFacilities: result.affectedFacilities,
      totalLoss: result.totalLoss,
    }
  }

  async assessDisaster(
    facilities: FloodFacility[],
    level: number,
    floodZone: FloodZone | null
  ): Promise<DisasterAssessment> {
    if (!floodZone || !Array.isArray(floodZone.features) || floodZone.features.length === 0) {
      // 无淹没多边形（0 档/无匹配档位）→ 无受影响设施（水位 0 = 无淹没）；
      // 风险等级统一「无风险」（与前端 colors.ts 键一致）
      return {
        affectedFacilities: [],
        totalLoss: 0,
        riskLevel: RISK_LEVEL_BANDS[0].label,
        waterLevel: undefined,
      }
    }

    // 设施评估基于淹没多边形空间筛选（与 online 模式连通演算同口径），
    // 替代点高程判断——内陆高地按高程会误判、按连通多边形不会
    const polygons = floodZone.features
      .filter(
        (f) => f?.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
      )
      .map((f) => f.geometry as GeoJsonGeometry)

    // 坐标非法设施不参与判定（NaN 经纬度无法构点）
    const candidates = facilities.filter(
      (facility) => Number.isFinite(Number(facility.lng)) && Number.isFinite(Number(facility.lat))
    )

    // 淹没多边形为空（档位下无 Polygon/MultiPolygon）→ 无命中，与旧实现同
    const hitIndices =
      polygons.length > 0 ? await this.spatial.pointIndicesInAnyPolygon(candidates, polygons) : []

    // 高程门控（P1.5，2026-09-12）：淹没几何生成含 300m 简化容差 + 降采样，沿岸高地设施
    // 会被外扩多边形吞进点面判定（实证：2m 档"淹"了 4 处 9-12m 码头，损失数字含假阳性）。
    // mask 语义是 dem ≤ level（EGM96），设施判定对齐之：多边形命中 且 设施高程 ≤ 实际选中
    // 档位值。高程缺失时退回纯点面判定（不因数据缺失漏报——宁可高估不可低估）。
    const pickedLevel = Number(floodZone.waterLevel)
    const gated = Number.isFinite(pickedLevel)
      ? hitIndices.filter((index) => {
          const elevation = Number(candidates[index].elevation)
          return !Number.isFinite(elevation) || elevation <= pickedLevel
        })
      : hitIndices

    const affectedFacilities = gated.map((index) => {
      const facility = candidates[index]
      return {
        id: facility.id,
        name: facility.name,
        type: facility.type,
        port: facility.port,
        lng: facility.lng,
        lat: facility.lat,
        elevation: facility.elevation,
        value: facility.value,
        damageRate: facility.damageRate,
        // value/damageRate 缺失/非数值时按 0 计（合法 0 保留，NaN/Infinity 归 0）
        loss:
          (Number.isFinite(Number(facility.value)) ? Number(facility.value) : 0) *
          (Number.isFinite(Number(facility.damageRate)) ? Number(facility.damageRate) : 0),
      }
    })

    const totalLoss = Math.round(affectedFacilities.reduce((sum, f) => sum + f.loss, 0))

    return {
      affectedFacilities,
      totalLoss,
      riskLevel: floodZone.riskLevel,
      waterLevel: floodZone.waterLevel,
    }
  }
}

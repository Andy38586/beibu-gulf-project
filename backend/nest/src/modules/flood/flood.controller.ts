import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { BusinessError, ErrorCode } from '../../common/errors/business-error'

import { FloodRepository } from './flood.repository'
import { FloodFacility, FloodService, FloodZone } from './flood.service'

/** 水位上限（米）—— 与 FastAPI 参数约束（le=25）及 02 §4.3 滑块范围一致（8-11：原 100 放宽越界） */
const MAX_WATER_LEVEL = 25

// 数据形状（backend/data/flood/*.json；repository 返回 unknown，此处声明消费视图）
interface FloodFeature {
  type?: string
  geometry?: { type?: string } | null
  properties?: Record<string, unknown>
}

interface FloodZoneEntry {
  waterLevel: number
  riskLevel: string
  features: FloodFeature[]
}

interface FloodAreaData {
  floodZones: FloodZoneEntry[]
}

interface StatisticsEntry extends Record<string, unknown> {
  waterLevel: number
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
 * 按水位派生风险等级（6 档语义：0 无 / 2 低 / 5 中 / 8 高 / 10 极高 / 15 灾难级；
 * 预计算档位表无 riskLevel 字段，由水位分段派生）
 */
export function deriveRiskLevel(level: number): string {
  if (level <= 0) return '无风险'
  if (level <= 2) return '低风险'
  if (level <= 5) return '中风险'
  if (level <= 8) return '高风险'
  if (level <= 10) return '极高风险'
  return '灾难级'
}

/**
 * 6 档向上取档：返回 >= 请求水位的最低档位；超档（15 < 水位 ≤ 25）取最高档兜底
 *（02 §4.3 宁可高估风险不可低估；表空返回 undefined 由调用方防御）
 */
function pickZone<T extends { waterLevel: number }>(zones: T[], level: number): T | undefined {
  return (
    zones.find((zone) => zone.waterLevel >= level) ??
    (zones.length ? zones.reduce((max, z) => (z.waterLevel > max.waterLevel ? z : max)) : undefined)
  )
}

/**
 * 洪涝读 API。路径约定对齐 backend/routes/floodAnalysis.js：资源型端点 kebab-case
 * 复数，操作型端点 /analysis/<action>。全部免鉴权（2026-08-29 收口 02 §4.5：仅收藏需登录，
 * disaster 评估为纯计算不读用户数据）。限流沿用全局限流桶（Express 侧无 skip 口径）。
 */
@Controller('flood')
@ApiTags('flood')
export class FloodController {
  constructor(
    private readonly floodRepository: FloodRepository,
    private readonly floodService: FloodService
  ) {}

  /**
   * GET /flood-areas?waterLevel=2.5 — 淹没范围数据。
   * 指定水位：6 档向上取档（Express 不再查 251 预计算表，8-2/8-3：曾致 flood-areas 与
   * flood-statistics 档位口径分裂，且精确命中违背"宁可高估"安全语义）；
   * 未指定：返回所有淹没范围。
   */
  @Get('flood-areas')
  async getFloodAreas(@Query('waterLevel') waterLevel?: string): Promise<unknown> {
    const data = (await this.floodRepository.readFloodArea()) as FloodAreaData

    // 指定了水位：返回对应档位淹没范围
    if (waterLevel !== undefined) {
      const level = validateWaterLevel(waterLevel)
      const effectiveZone = pickZone(data.floodZones, level)

      if (effectiveZone) {
        return {
          waterLevel: effectiveZone.waterLevel,
          // 显式区分请求水位与实际数据档位（向上取档时 actual > requested，前端可感知）
          requestedWaterLevel: level,
          actualWaterLevel: effectiveZone.waterLevel,
          riskLevel: effectiveZone.riskLevel,
          // 后端权威注入 riskLevel，满足前端 FloodFeature 类型契约，前端无需再补映射层
          features: effectiveZone.features.map((f) => ({
            ...f,
            properties: { ...f.properties, riskLevel: effectiveZone.riskLevel },
          })),
        }
      }

      // 数据表为空的防御兜底（正常路径不可达：请求 0-25 均有档位可取）
      return {
        waterLevel: level,
        requestedWaterLevel: level,
        actualWaterLevel: level,
        riskLevel: '无风险',
        features: [],
      }
    }

    // 未指定水位，返回所有淹没范围
    return data.floodZones
  }

  /** GET /flood-statistics?waterLevel=2.5 — 统计数据（向上取档；超档取最高档，不静默返 null） */
  @Get('flood-statistics')
  async getFloodStatistics(@Query('waterLevel') waterLevel?: string): Promise<unknown> {
    const data = (await this.floodRepository.readFloodStatistics()) as FloodStatisticsData

    if (waterLevel !== undefined) {
      const level = validateWaterLevel(waterLevel)
      const stats = pickZone(data.statistics, level)
      return stats ?? null
    }

    return data.statistics
  }

  /**
   * GET /terrain-profiles — 剖面数据。
   * 垂直基准偏移：水位(理论深度基准面) - datumOffset = 剖面高程基准(EGM96 正高)。
   * 逐条 profile 透传，供水面线与地形同基准绘制。
   */
  @Get('terrain-profiles')
  async getTerrainProfiles(): Promise<unknown> {
    const data = (await this.floodRepository.readTerrainProfile()) as TerrainProfileData
    const datumOffset = data.metadata?.datumOffset ?? 0
    return data.profiles.map((p) => ({ ...p, datumOffset }))
  }

  /** GET /water-area — 水域边界坐标数组 [[lng, lat], ...]（与前端 floodAdapter.getWaterArea 消费形状一致） */
  @Get('water-area')
  async getWaterArea(): Promise<unknown> {
    const data = (await this.floodRepository.readWaterArea()) as WaterAreaData
    if (!Array.isArray(data?.coordinates) || data.coordinates.length === 0) {
      throw new BusinessError(ErrorCode.NOT_FOUND, '水域坐标数据缺失或格式无效')
    }
    return data.coordinates
  }

  /**
   * POST /analysis/disaster — 灾害评估（免鉴权，纯计算）。
   * @HttpCode(200)：Express sendSuccess 默认 200，非"资源创建"端点必须显式对齐
   *（favorites add、plans saveXiaoqu 均实锤过 POST 201 默认值坑）。
   */
  @Post('analysis/disaster')
  @HttpCode(200)
  async analyzeDisaster(@Body() body?: { waterLevel?: unknown }): Promise<unknown> {
    const { waterLevel } = body ?? {}

    if (waterLevel === undefined) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '缺少水位参数')
    }

    const level = validateWaterLevel(waterLevel)

    // 读取设施数据和淹没范围
    const facilityData = (await this.floodRepository.readFacilityPoints()) as FacilityData
    const floodData = (await this.floodRepository.readFloodArea()) as FloodAreaData

    // 6 档向上取档（与 getFloodAreas 同口径；超档取最高档 15m，不静默空评估）
    const floodZone: FloodZone | null = pickZone(floodData.floodZones, level) ?? null

    // 业务计算委托给 floodService
    const result = this.floodService.assessDisaster(facilityData.facilities, level, floodZone)

    return {
      // 返回实际档位水位，消除请求值与实际档位的错配
      waterLevel: result.waterLevel,
      requestedWaterLevel: level,
      riskLevel: result.riskLevel,
      affectedFacilities: result.affectedFacilities,
      totalLoss: result.totalLoss,
    }
  }
}

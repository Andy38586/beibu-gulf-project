import {
  readFacilityPoints,
  readFloodArea,
  readFloodStatistics,
  readTerrainProfile,
  readWaterArea,
} from '../repositories/floodRepository.js'
import { assessDisaster } from '../services/floodService.js'
import { BusinessError, ErrorCode } from '../utils/BusinessError.js'
import { logger } from '../utils/logger.js'
import { sendSuccess } from '../utils/response.js'

/** 水位上限（米）—— 与 FastAPI 参数约束（le=25）及 02 §4.3 滑块范围一致（8-11：原 100 放宽越界） */
const MAX_WATER_LEVEL = 25

/** 校验水位：有限数值且在 0–100 范围内，否则抛业务错误 */
function validateWaterLevel(raw) {
  const level = parseFloat(raw)
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
export function deriveRiskLevel(level) {
  if (level <= 0) return '无风险'
  if (level <= 2) return '低风险'
  if (level <= 5) return '中风险'
  if (level <= 8) return '高风险'
  if (level <= 10) return '极高风险'
  return '灾难级'
}

/**
 * GET /api/flood/flood-areas?waterLevel=2.5 — 淹没范围数据。
 * api 模式：6 档向上取档（02 §4.3 应然——宁可高估风险不可低估，前端经 requested/actual 感知差异）；
 * 251 档预计算表归 online 模式（FastAPI），Express 侧不再查表（8-2/8-3：曾致 flood-areas 与
 * flood-statistics 档位口径分裂，且精确命中违背"宁可高估"安全语义）
 */
export async function getFloodAreas(req, res, next) {
  try {
    const { waterLevel } = req.query
    const data = await readFloodArea()

    // 指定了水位：返回对应档位淹没范围
    if (waterLevel !== undefined) {
      const level = validateWaterLevel(waterLevel)

      // 6 档向上取档（返回 >= 请求水位的最低档位）；
      // Q1（816 拍板）：15 < 水位 ≤ 25 延续向上取档语义——取最高档（15m，宁可高估风险），
      // 不再静默返回空淹没（8-6 曾致风险语义反转：水位越高显示越安全）
      const effectiveZone =
        data.floodZones.find((zone) => zone.waterLevel >= level) ??
        (data.floodZones.length
          ? data.floodZones.reduce((max, z) => (z.waterLevel > max.waterLevel ? z : max))
          : undefined)

      if (effectiveZone) {
        return sendSuccess(res, {
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
        })
      }

      // 数据表为空的防御兜底（正常路径不可达：请求 0-25 均有档位可取）
      return sendSuccess(res, {
        waterLevel: level,
        requestedWaterLevel: level,
        actualWaterLevel: level,
        riskLevel: '无风险',
        features: [],
      })
    }

    // 未指定水位，返回所有淹没范围
    sendSuccess(res, data.floodZones)
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('获取淹没范围失败:', error)
    }
    next(error)
  }
}

/**
 * 获取统计数据
 * GET /api/flood/flood-statistics?waterLevel=2.5
 */
export async function getFloodStatistics(req, res, next) {
  try {
    const { waterLevel } = req.query
    const data = await readFloodStatistics()

    if (waterLevel !== undefined) {
      const level = validateWaterLevel(waterLevel)

      // 找到最接近的水位统计（向上取档；Q1 同 getFloodAreas：超档取最高档，不静默返 null）
      const stats =
        data.statistics.find((s) => s.waterLevel >= level) ??
        (data.statistics.length
          ? data.statistics.reduce((max, s) => (s.waterLevel > max.waterLevel ? s : max))
          : undefined)
      if (stats) {
        return sendSuccess(res, stats)
      }

      return sendSuccess(res, null)
    }

    sendSuccess(res, data.statistics)
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('获取统计数据失败:', error)
    }
    next(error)
  }
}

/**
 * 获取剖面数据
 * GET /api/flood/terrain-profiles
 */
export async function getTerrainProfiles(req, res, next) {
  try {
    const data = await readTerrainProfile()
    // 垂直基准偏移：水位(理论深度基准面) - datumOffset = 剖面高程基准(EGM96 正高)。
    // 逐条 profile 透传（前端 schema 为 looseObject，保留该字段），供水面线与地形同基准绘制。
    const datumOffset = data.metadata?.datumOffset ?? 0
    sendSuccess(
      res,
      data.profiles.map((p) => ({ ...p, datumOffset }))
    )
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('获取剖面数据失败:', error)
    }
    next(error)
  }
}

/**
 * GET /api/flood/water-area — 水域边界坐标数组 [[lng, lat], ...]
 * （与前端 floodAdapter.getWaterArea 消费形状一致）
 */
export async function getWaterArea(req, res, next) {
  try {
    const data = await readWaterArea()
    if (!Array.isArray(data?.coordinates) || data.coordinates.length === 0) {
      throw new BusinessError(ErrorCode.NOT_FOUND, '水域坐标数据缺失或格式无效')
    }
    sendSuccess(res, data.coordinates)
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('获取水域坐标失败:', error)
    }
    next(error)
  }
}

/** POST /api/flood/analysis/disaster — 灾害评估（需登录） */
export async function analyzeDisaster(req, res, next) {
  try {
    const { waterLevel } = req.body

    if (waterLevel === undefined) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '缺少水位参数')
    }

    const level = validateWaterLevel(waterLevel)

    // 读取设施数据和淹没范围
    const facilityData = await readFacilityPoints()
    const floodData = await readFloodArea()

    // 6 档向上取档（与 getFloodAreas 同口径；8-2/8-3 回退 api 6 档设计，251 查表归 online）
    // Q1（816 拍板）：超档（15<水位≤25）取最高档（15m），延续向上取档语义，不静默空评估
    const floodZone =
      floodData.floodZones.find((zone) => zone.waterLevel >= level) ??
      (floodData.floodZones.length
        ? floodData.floodZones.reduce((max, z) => (z.waterLevel > max.waterLevel ? z : max))
        : undefined)

    // 业务计算委托给 floodService
    const result = assessDisaster(facilityData.facilities, level, floodZone)

    sendSuccess(res, {
      // 返回实际档位水位，消除请求值与实际档位的错配
      waterLevel: result.waterLevel,
      requestedWaterLevel: level,
      riskLevel: result.riskLevel,
      affectedFacilities: result.affectedFacilities,
      totalLoss: result.totalLoss,
    })
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('灾害评估失败:', error)
    }
    next(error)
  }
}

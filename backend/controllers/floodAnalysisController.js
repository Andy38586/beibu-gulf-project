import { assessDisaster } from '../services/floodService.js'
import { BusinessError, ErrorCode } from '../utils/BusinessError.js'
import { loadFloodLevels } from '../utils/floodLevelsStore.js'
import { logger } from '../utils/logger.js'
import { readStaticJson } from '../utils/readStaticJson.js'
import { sendSuccess } from '../utils/response.js'

/** 水位上限（米）—— 超出此值视为非法输入 */
const MAX_WATER_LEVEL = 100

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

/** 查预计算档位表（0.1m 档全量水位，与 FastAPI 同源）；miss 返回 null，调用方回退 6 档 */
async function lookupFloodZone(level) {
  const table = await loadFloodLevels()
  const key = Math.round(level * 10) / 10
  const pre = table[String(key)]
  if (!pre?.features || pre.features.length === 0) return null
  return {
    waterLevel: key,
    riskLevel: deriveRiskLevel(key),
    features: pre.features,
  }
}

/**
 * GET /api/flood/flood-areas?waterLevel=2.5 — 淹没范围数据。
 * 优先查 251 档预计算表（0.1m 步长精确响应），缺失/越界回退 6 档向上取档
 */
export async function getFloodAreas(req, res, next) {
  try {
    const { waterLevel } = req.query
    const data = await readStaticJson('flood/floodArea.json')

    // 指定了水位：返回对应档位淹没范围
    if (waterLevel !== undefined) {
      const level = validateWaterLevel(waterLevel)

      // ① 预计算档位表（251 档精确命中）
      const floodZone = (await lookupFloodZone(level)) || null
      const effectiveZone =
        floodZone ||
        // ② fallback：6 档向上取档（返回 >= 请求水位的最低档位）
        data.floodZones.find((zone) => zone.waterLevel >= level)

      if (effectiveZone) {
        return sendSuccess(res, {
          waterLevel: effectiveZone.waterLevel,
          // 显式区分请求水位与实际数据档位（查表命中时二者一致，无档位偏差提示）
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

      // 如果水位超出范围，返回空
      return sendSuccess(res, {
        waterLevel: level,
        riskLevel: '无',
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
    const data = await readStaticJson('flood/floodStatistics.json')

    if (waterLevel !== undefined) {
      const level = validateWaterLevel(waterLevel)

      // 找到最接近的水位统计
      const stats = data.statistics.find((s) => s.waterLevel >= level)
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
    const data = await readStaticJson('flood/terrainProfile.json')
    sendSuccess(res, data.profiles)
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
    const data = await readStaticJson('flood/water-area.json')
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
    const facilityData = await readStaticJson('flood/facilityPoints.json')
    const floodData = await readStaticJson('flood/floodArea.json')

    // ① 预计算档位表查表（与 getFloodAreas 同源）；miss 回退 6 档向上取档
    const floodZone =
      (await lookupFloodZone(level)) ||
      floodData.floodZones.find((zone) => zone.waterLevel >= level)

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

import { readFile } from 'fs/promises'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { BusinessError, ErrorCode } from '../utils/BusinessError.js'
import { logger } from '../utils/logger.js'
import { sendSuccess } from '../utils/response.js'
import { assessDisaster } from '../services/floodService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * 读取JSON数据文件
 * @param {string} filename - 文件名
 * @returns {Promise<Object>} 解析后的JSON数据
 */
// REQ-3（阶段2）: flood 5 个数据接口公开可高频访问，原每次请求 readFile 无缓存。
// 加模块级 Map + TTL（复用 facilitiesRepository.js 成熟模式）；纯读路径、数据为部署时静态，TTL 足够。
// z050-BE: 读盘缓存（模块级 Map + TTL）。导出供测试访问。
export const _readCache = new Map()
const READ_CACHE_TTL_MS = 5 * 60 * 1000
// z050-BE: 读盘缓存大小上限。flood 数据文件数量（~5）远小于 20，近似 LRU 一行实现即可。
const READ_CACHE_MAX_SIZE = 20
function setReadCache(filename, data) {
  if (_readCache.size >= READ_CACHE_MAX_SIZE) {
    // 淘汰最早插入的条目（Map 保持插入顺序）
    const oldestKey = _readCache.keys().next().value
    if (oldestKey !== undefined) _readCache.delete(oldestKey)
  }
  _readCache.set(filename, { data, cachedAt: Date.now() })
}
export async function readJsonData(filename) {
  const hit = _readCache.get(filename)
  if (hit && Date.now() - hit.cachedAt < READ_CACHE_TTL_MS) {
    return hit.data
  }
  const filePath = join(__dirname, '../data/flood', filename)
  const data = JSON.parse(await readFile(filePath, 'utf-8'))
  setReadCache(filename, data)
  return data
}

/** 测试用：清空模块级读盘缓存，避免跨用例污染（REQ-3） */
export function _clearCacheForTest() {
  _readCache.clear()
}

/** 水位上限（米）—— 超出此值视为非法输入 */
const MAX_WATER_LEVEL = 100

/**
 * 校验水位参数（d034：isFinite + 范围校验）
 * @param {unknown} raw - 原始输入（query/body）
 * @returns {number} 合法水位值
 * @throws {BusinessError} 参数无效时抛出
 */
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
 * 获取基准水位数据
 * GET /api/flood/water-levels
 */
export async function getWaterLevels(req, res, next) {
  try {
    const data = await readJsonData('waterLevel.json')
    sendSuccess(res, {
      baseLevels: data.baseLevels,
      simulationRange: data.simulationRange,
      tidalStations: data.tidalStations,
    })
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('获取水位数据失败:', error)
    }
    next(error)
  }
}

/**
 * 获取淹没范围数据
 * GET /api/flood/flood-areas?waterLevel=2.5
 * @param {number} waterLevel - 水位高度（米）
 */
export async function getFloodAreas(req, res, next) {
  try {
    const { waterLevel } = req.query
    const data = await readJsonData('floodArea.json')

    // 如果指定了水位，返回该水位对应的淹没范围
    if (waterLevel !== undefined) {
      const level = validateWaterLevel(waterLevel)

      // 向上取档（返回 >= 请求水位的最低档位）
      const floodZone = data.floodZones.find((zone) => zone.waterLevel >= level)
      if (floodZone) {
        return sendSuccess(res, {
          waterLevel: floodZone.waterLevel,
          // @arch-note P2-07: 显式区分请求水位与实际数据档位
          requestedWaterLevel: level,
          actualWaterLevel: floodZone.waterLevel,
          riskLevel: floodZone.riskLevel,
          features: floodZone.features,
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
    const data = await readJsonData('floodStatistics.json')

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
    const data = await readJsonData('terrainProfile.json')
    sendSuccess(res, data.profiles)
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('获取剖面数据失败:', error)
    }
    next(error)
  }
}

/**
 * 获取设施点数据
 * GET /api/flood/facilities
 */
export async function getFacilities(req, res, next) {
  try {
    const data = await readJsonData('facilityPoints.json')
    sendSuccess(res, data.facilities)
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('获取设施数据失败:', error)
    }
    next(error)
  }
}

/**
 * 灾害评估
 * POST /api/flood/analysis/disaster
 * @param {number} waterLevel - 水位高度
 */
export async function analyzeDisaster(req, res, next) {
  try {
    const { waterLevel } = req.body

    if (waterLevel === undefined) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '缺少水位参数')
    }

    const level = validateWaterLevel(waterLevel)

    // 读取设施数据和淹没范围
    const facilityData = await readJsonData('facilityPoints.json')
    const floodData = await readJsonData('floodArea.json')

    // 向上取档（返回 >= 请求水位的最低档位）
    const floodZone = floodData.floodZones.find((zone) => zone.waterLevel >= level)

    // d041: 业务计算委托给 floodService
    const result = assessDisaster(facilityData.facilities, level, floodZone)

    sendSuccess(res, {
      // @arch-note P2-07: 返回实际档位水位，消除请求值与实际档位的错配
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

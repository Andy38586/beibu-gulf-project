import { readFile } from 'fs/promises'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { BusinessError, ErrorCode } from '../utils/BusinessError.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * 读取JSON数据文件
 * @param {string} filename - 文件名
 * @returns {Promise<Object>} 解析后的JSON数据
 */
async function readJsonData(filename) {
  const filePath = join(__dirname, '../data/flood', filename)
  const data = await readFile(filePath, 'utf-8')
  return JSON.parse(data)
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
    res.json({
      code: 200,
      data: {
        baseLevels: data.baseLevels,
        simulationRange: data.simulationRange,
        tidalStations: data.tidalStations,
      },
      message: 'success',
    })
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      console.error('获取水位数据失败:', error)
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
        return res.json({
          code: 200,
          data: {
            waterLevel: floodZone.waterLevel,
            // @arch-note P2-07: 显式区分请求水位与实际数据档位
            requestedWaterLevel: level,
            actualWaterLevel: floodZone.waterLevel,
            riskLevel: floodZone.riskLevel,
            features: floodZone.features,
          },
          message: 'success',
        })
      }

      // 如果水位超出范围，返回空
      return res.json({
        code: 200,
        data: {
          waterLevel: level,
          riskLevel: '无',
          features: [],
        },
        message: 'success',
      })
    }

    // 未指定水位，返回所有淹没范围
    res.json({
      code: 200,
      data: data.floodZones,
      message: 'success',
    })
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      console.error('获取淹没范围失败:', error)
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
        return res.json({
          code: 200,
          data: stats,
          message: 'success',
        })
      }

      return res.json({
        code: 200,
        data: null,
        message: '未找到对应水位的统计数据',
      })
    }

    res.json({
      code: 200,
      data: data.statistics,
      message: 'success',
    })
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      console.error('获取统计数据失败:', error)
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
    res.json({
      code: 200,
      data: data.profiles,
      message: 'success',
    })
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      console.error('获取剖面数据失败:', error)
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
    res.json({
      code: 200,
      data: data.facilities,
      message: 'success',
    })
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      console.error('获取设施数据失败:', error)
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

    if (!floodZone) {
      return res.json({
        code: 200,
        data: {
          affectedFacilities: [],
          totalLoss: 0,
          riskLevel: '无',
        },
        message: 'success',
      })
    }

    // 简化的灾害评估：根据水位和风险等级计算损失
    const affectedFacilities = facilityData.facilities
      .filter((facility) => facility.elevation <= level)
      .map((facility) => ({
        id: facility.id,
        name: facility.name,
        type: facility.type,
        port: facility.port,
        lng: facility.lng,
        lat: facility.lat,
        elevation: facility.elevation,
        value: facility.value,
        damageRate: facility.damageRate,
        loss: facility.value * facility.damageRate,
      }))

    const totalLoss = affectedFacilities.reduce((sum, f) => sum + f.loss, 0)

    res.json({
      code: 200,
      data: {
        // @arch-note P2-07: 返回实际档位水位，消除请求值与实际档位的错配
        waterLevel: floodZone.waterLevel,
        requestedWaterLevel: level,
        riskLevel: floodZone.riskLevel,
        affectedFacilities,
        totalLoss: Math.round(totalLoss),
      },
      message: 'success',
    })
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      console.error('灾害评估失败:', error)
    }
    next(error)
  }
}

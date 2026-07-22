import { readFile } from 'fs/promises'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

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

/**
 * 获取基准水位数据
 * GET /api/gcs/water-levels
 */
export async function getWaterLevels(req, res) {
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
    console.error('获取水位数据失败:', error)
    res.status(500).json({
      code: 500,
      data: null,
      message: '获取水位数据失败',
    })
  }
}

/**
 * 获取淹没范围数据
 * GET /api/gcs/flood-areas?waterLevel=2.5
 * @param {number} waterLevel - 水位高度（米）
 */
export async function getFloodAreas(req, res) {
  try {
    const { waterLevel } = req.query
    const data = await readJsonData('floodArea.json')

    // 如果指定了水位，返回该水位对应的淹没范围
    if (waterLevel !== undefined) {
      const level = parseFloat(waterLevel)
      if (isNaN(level)) {
        return res.status(400).json({
          code: 400,
          data: null,
          message: '水位参数无效',
        })
      }

      // 找到最接近的水位区间
      const floodZone = data.floodZones.find((zone) => zone.waterLevel >= level)
      if (floodZone) {
        return res.json({
          code: 200,
          data: {
            waterLevel: floodZone.waterLevel,
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
    console.error('获取淹没范围失败:', error)
    res.status(500).json({
      code: 500,
      data: null,
      message: '获取淹没范围失败',
    })
  }
}

/**
 * 获取统计数据
 * GET /api/gcs/flood-statistics?waterLevel=2.5
 */
export async function getFloodStatistics(req, res) {
  try {
    const { waterLevel } = req.query
    const data = await readJsonData('floodStatistics.json')

    if (waterLevel !== undefined) {
      const level = parseFloat(waterLevel)
      if (isNaN(level)) {
        return res.status(400).json({
          code: 400,
          data: null,
          message: '水位参数无效',
        })
      }

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
    console.error('获取统计数据失败:', error)
    res.status(500).json({
      code: 500,
      data: null,
      message: '获取统计数据失败',
    })
  }
}

/**
 * 获取剖面数据
 * GET /api/gcs/terrain-profiles
 */
export async function getTerrainProfiles(req, res) {
  try {
    const data = await readJsonData('terrainProfile.json')
    res.json({
      code: 200,
      data: data.profiles,
      message: 'success',
    })
  } catch (error) {
    console.error('获取剖面数据失败:', error)
    res.status(500).json({
      code: 500,
      data: null,
      message: '获取剖面数据失败',
    })
  }
}

/**
 * 获取设施点数据
 * GET /api/gcs/facilities
 */
export async function getFacilities(req, res) {
  try {
    const data = await readJsonData('facilityPoints.json')
    res.json({
      code: 200,
      data: data.facilities,
      message: 'success',
    })
  } catch (error) {
    console.error('获取设施数据失败:', error)
    res.status(500).json({
      code: 500,
      data: null,
      message: '获取设施数据失败',
    })
  }
}

/**
 * 灾害评估
 * POST /api/gcs/analysis/disaster
 * @param {number} waterLevel - 水位高度
 */
export async function analyzeDisaster(req, res) {
  try {
    const { waterLevel } = req.body

    if (waterLevel === undefined || isNaN(parseFloat(waterLevel))) {
      return res.status(400).json({
        code: 400,
        data: null,
        message: '缺少水位参数',
      })
    }

    const level = parseFloat(waterLevel)

    // 读取设施数据和淹没范围
    const facilityData = await readJsonData('facilityPoints.json')
    const floodData = await readJsonData('floodArea.json')

    // 找到对应水位的淹没范围
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
        longitude: facility.longitude,
        latitude: facility.latitude,
        elevation: facility.elevation,
        value: facility.value,
        damageRate: facility.damageRate,
        loss: facility.value * facility.damageRate,
      }))

    const totalLoss = affectedFacilities.reduce((sum, f) => sum + f.loss, 0)

    res.json({
      code: 200,
      data: {
        waterLevel: level,
        riskLevel: floodZone.riskLevel,
        affectedFacilities,
        totalLoss: Math.round(totalLoss),
      },
      message: 'success',
    })
  } catch (error) {
    console.error('灾害评估失败:', error)
    res.status(500).json({
      code: 500,
      data: null,
      message: '灾害评估失败',
    })
  }
}

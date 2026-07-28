import * as turf from '@turf/turf'
import { scoreXiaoqu, DEFAULT_WEIGHTS } from './scoringService.js'
import { linearDecay } from './decayFunctions.js'
import { importanceToRadius } from './importanceMapping.js'
import { createSpatialIndex, queryByPolygon } from '../utils/spatialIndex.js'
import { BusinessError, ErrorCode } from '../utils/BusinessError.js'

const TOP_N = 10

export function validateSelection(selectedKeys) {
  if (!selectedKeys || selectedKeys.length === 0) {
    return '请至少选择一种设施类型'
  }
  return null
}
export function resolveRadiusSettings(selectedKeys, typeSettings) {
  const resolved = {}
  selectedKeys.forEach((key) => {
    const setting = typeSettings[key]
    const radius = importanceToRadius(setting.defaultRadius, setting.importance)

    // @arch-note 106: 校验半径必须为正数
    if (radius <= 0 || isNaN(radius)) {
      // [FIXED 016] 仅在开发环境输出警告
      if (process.env.NODE_ENV === 'development') {
        console.warn(`设施类型 ${key} 的缓冲区半径无效: ${radius}`)
      }
      // @arch-note P1-08: 参数错误带码抛出，控制器据码返 400
      throw new BusinessError(ErrorCode.INVALID_PARAMS, `半径参数无效: ${radius}`)
    }

    resolved[key] = { selected: true, radius }
  })
  return resolved
}
export function buildTypeCoverage(points, radiusKm) {
  if (!points || points.length === 0) return null

  // @arch-note 315-001: 性能优化提示 - 大量POI数据建议实现聚类或空间索引
  if (points.length > 1000 && process.env.NODE_ENV === 'development') {
    console.warn(`[性能优化] POI数据量较大(${points.length}条)，建议实现聚类或空间索引优化`)
  }

  // @arch-note 314-002: POI数据去重（基于坐标）
  const uniquePoints = []
  const seenCoords = new Set()
  for (const p of points) {
    const coordKey = `${p.lng},${p.lat}`
    if (!seenCoords.has(coordKey)) {
      seenCoords.add(coordKey)
      uniquePoints.push(p)
    }
  }

  // @arch-note 314-003: 过滤异常坐标[0,0]和不在北部湾范围内的坐标
  // 北部湾范围：经度 105-115，纬度 18-25
  const validPoints = uniquePoints.filter((p) => {
    const isValid =
      p &&
      typeof p.lng === 'number' &&
      typeof p.lat === 'number' &&
      !isNaN(p.lng) &&
      !isNaN(p.lat) &&
      !(p.lng === 0 && p.lat === 0) && // 过滤[0,0]异常坐标
      p.lng >= 105 &&
      p.lng <= 115 && // 北部湾经度范围
      p.lat >= 18 &&
      p.lat <= 25 // 北部湾纬度范围
    // [FIXED 016] 仅在开发环境输出警告
    if (!isValid && process.env.NODE_ENV === 'development') {
      console.warn('无效的坐标点:', p)
    }
    return isValid
  })

  if (validPoints.length === 0) {
    // [FIXED 016] 仅在开发环境输出警告
    if (process.env.NODE_ENV === 'development') {
      console.warn('没有有效的坐标点')
    }
    return null
  }

  const buffers = validPoints.map((p) =>
    turf.buffer(turf.point([p.lng, p.lat]), radiusKm, { units: 'kilometers' })
  )

  // 过滤掉无效的缓冲区
  // @arch-note GIS-004: 验证坐标数组长度
  const validBuffers = buffers.filter(
    (b) => b && b.geometry && b.geometry.coordinates && b.geometry.coordinates.length > 0
  )
  if (validBuffers.length === 0) {
    // [FIXED 016] 仅在开发环境输出警告
    if (process.env.NODE_ENV === 'development') {
      console.warn('没有有效的缓冲区')
    }
    return null
  }

  if (validBuffers.length === 1) return validBuffers[0]

  try {
    const unionResult = turf.union(turf.featureCollection(validBuffers))
    // @arch-note GIS-001: 验证 union 结果，处理 MultiPolygon 情况
    if (!unionResult || !unionResult.geometry) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('union 返回无效结果')
      }
      return null
    }

    // @arch-note GIS-007: 如果返回 MultiPolygon，保留所有 Polygon 作为覆盖区域
    // 返回第一个 Polygon 作为主覆盖区域，但记录所有 Polygon 的坐标
    if (unionResult.geometry.type === 'MultiPolygon') {
      if (process.env.NODE_ENV === 'development') {
        console.warn('turf.union 返回 MultiPolygon，保留所有 Polygon')
      }
      // 返回完整的 MultiPolygon，而不是只返回第一个
      return unionResult
    }

    return unionResult
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('turf.union 失败:', error.message)
      console.error('缓冲区数量:', validBuffers.length)
    }
    return null
  }
}
export function intersectCoverages(coverages, selectedKeys) {
  const entries = coverages
    .map((c, i) => ({ key: selectedKeys[i], coverage: c }))
    .filter((e) => e.coverage && e.coverage.geometry)

  if (entries.length === 0) return { area: null, failKey: null }

  let result = entries[0].coverage

  for (let i = 1; i < entries.length; i++) {
    try {
      // 验证输入几何对象
      if (
        !result.geometry ||
        !result.geometry.coordinates ||
        !entries[i].coverage.geometry ||
        !entries[i].coverage.geometry.coordinates
      ) {
        // [FIXED 016] 仅在开发环境输出警告
        if (process.env.NODE_ENV === 'development') {
          console.warn(`无效的几何对象，跳过 ${entries[i].key}`)
        }
        continue
      }

      const intersectResult = turf.intersect(turf.featureCollection([result, entries[i].coverage]))

      if (!intersectResult || !intersectResult.geometry) {
        return { area: null, failKey: entries[i].key }
      }

      result = intersectResult
    } catch (error) {
      // [FIXED 016] 仅在开发环境输出错误
      if (process.env.NODE_ENV === 'development') {
        console.error(`turf.intersect 失败 (${entries[i].key}):`, error.message)
      }
      return { area: null, failKey: entries[i].key }
    }
  }

  return { area: result, failKey: null }
}
export function filterMatchedXiaoqu(xiaoquData, finalArea, spatialIndex = null) {
  // @arch-note 314-001: 检查 xiaoquData 是否为空或 null
  if (!xiaoquData || xiaoquData.length === 0) {
    // [FIXED 016] 仅在开发环境输出警告
    if (process.env.NODE_ENV === 'development') {
      console.warn('小区数据为空')
    }
    return []
  }

  const candidates = spatialIndex ? queryByPolygon(spatialIndex, finalArea) : xiaoquData

  // @arch-note 314-004: 验证 GeoJSON Feature 完整性
  return candidates.filter((xq) => {
    // 检查必要字段
    if (!xq || typeof xq.lng !== 'number' || typeof xq.lat !== 'number') {
      // [FIXED 016] 仅在开发环境输出警告
      if (process.env.NODE_ENV === 'development') {
        console.warn('小区数据缺少坐标字段:', xq)
      }
      return false
    }
    // 检查坐标有效性
    if (
      isNaN(xq.lng) ||
      isNaN(xq.lat) ||
      xq.lng < -180 ||
      xq.lng > 180 ||
      xq.lat < -90 ||
      xq.lat > 90
    ) {
      // [FIXED 016] 仅在开发环境输出警告
      if (process.env.NODE_ENV === 'development') {
        console.warn('小区坐标无效:', xq)
      }
      return false
    }
    // @arch-note 314-003: 检查坐标是否在北部湾业务区域内（经度 105-115，纬度 18-25）
    if (xq.lng < 105 || xq.lng > 115 || xq.lat < 18 || xq.lat > 25) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('小区坐标不在北部湾业务区域内:', xq)
      }
      return false
    }
    try {
      return turf.booleanPointInPolygon(turf.point([xq.lng, xq.lat]), finalArea)
    } catch (error) {
      // [FIXED 016] 仅在开发环境输出警告
      if (process.env.NODE_ENV === 'development') {
        console.warn('空间判断失败:', error.message, xq)
      }
      return false
    }
  })
}
export function rankXiaoqu(matched, facilityData, radiusSettings, weights) {
  const scored = scoreXiaoqu(matched, facilityData, radiusSettings, weights, linearDecay)
  return scored.sort((a, b) => b.score - a.score).slice(0, TOP_N)
}
/**
 * 筛选覆盖范围内的设施POI
 * @param {Object} facilityData - 设施数据 { type: [{lng, lat, name}] }
 * @param {Object} finalArea - 覆盖范围 GeoJSON
 * @param {Array} selectedKeys - 选中的设施类型
 * @returns {Object} 各类型设施POI { type: [{lng, lat, name}] }
 */
export function filterFacilitiesInCoverage(facilityData, finalArea, selectedKeys) {
  const result = {}
  selectedKeys.forEach((key) => {
    const points = facilityData[key]
    if (!points || points.length === 0) {
      result[key] = []
      return
    }
    result[key] = points.filter((p) => {
      if (!p || typeof p.lng !== 'number' || typeof p.lat !== 'number') return false
      return turf.booleanPointInPolygon(turf.point([p.lng, p.lat]), finalArea)
    })
  })
  return result
}

export function runSiteAnalysis({ selectedKeys, typeSettings, facilityData, xiaoquData, weights }) {
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
    return {
      error: `${failKey} 的覆盖范围与其他类型无重叠区域`,
      coverage: null,
      matchedXiaoqu: [],
      facilityPoi: {},
    }
  }
  const spatialIndex = createSpatialIndex(xiaoquData)
  const matched = filterMatchedXiaoqu(xiaoquData, finalArea, spatialIndex)
  const top = rankXiaoqu(matched, facilityData, radiusSettings, finalWeights)

  // 筛选覆盖范围内的设施POI
  const facilityPoi = filterFacilitiesInCoverage(facilityData, finalArea, selectedKeys)

  return { error: null, coverage: finalArea, matchedXiaoqu: top, facilityPoi }
}

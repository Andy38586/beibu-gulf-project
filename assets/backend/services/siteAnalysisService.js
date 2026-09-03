import * as turf from '@turf/turf'

import { BusinessError, ErrorCode } from '../utils/BusinessError.js'
import { logger } from '../utils/logger.js'
import { createSpatialIndex, queryByPolygon } from '../utils/spatialIndex.js'

import { DEFAULT_WEIGHTS, importanceToRadius, linearDecay, scoreXiaoqu } from './scoringService.js'

// 评分排序取前 N 名（816-专项8 发现7：取值依据——557 小区规模下取前 10 覆盖可达性核心结论区间，
// 前端 SiteSelectionPage 另行 slice(0,8) 展示截断，不硬依赖本值；如数据翻倍需重评估）
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
    // 防御键集不一致：API 公开，异常请求可能缺键，缺键抛业务错误而非 TypeError
    if (!setting || typeof setting !== 'object') {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, `设施类型 ${key} 缺少 typeSettings 配置`)
    }
    const radius = importanceToRadius(setting.defaultRadius, setting.importance)

    // 校验半径必须为正数
    if (radius <= 0 || isNaN(radius)) {
      logger.debug(`设施类型 ${key} 的缓冲区半径无效: ${radius}`)
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
export function extractValidPoi(points) {
  if (!points || points.length === 0) return []

  // POI数据去重（基于坐标）
  const uniquePoints = []
  const seenCoords = new Set()
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
    // 仅在开发环境输出警告
    if (!isValid) {
      logger.debug('无效的坐标点:', p)
    }
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
function unionDivide(features) {
  if (features.length === 1) return features[0]
  const mid = Math.floor(features.length / 2)
  const left = unionDivide(features.slice(0, mid))
  const right = unionDivide(features.slice(mid))
  if (!left || !left.geometry) return right
  if (!right || !right.geometry) return left
  try {
    return turf.union(turf.featureCollection([left, right]))
  } catch (error) {
    logger.error('分治 union 失败:', error.message, '缓冲区数量:', features.length)
    // 降级：返回已合并的半边，宁可覆盖范围偏小也不中断整个选址流程
    return left
  }
}

export function buildTypeCoverage(points, radiusKm) {
  const validPoints = extractValidPoi(points)
  if (validPoints.length === 0) {
    logger.debug('没有有效的坐标点')
    return null
  }

  // 性能优化提示 - 大量POI数据建议实现聚类或空间索引
  if (validPoints.length > 1000) {
    logger.debug(`[性能优化] POI数据量较大(${validPoints.length}条)，建议实现聚类或空间索引优化`)
  }

  // steps=2 降低缓冲区离散精度（每圆 8 顶点而非 ~33）。覆盖多边形用于可视化与点面判定，
  // 八边形逼近在 0.5~3km 尺度上肉眼无差，但顶点数降至约 1/3，直接压低后续 union 成本。
  const buffers = validPoints.map((p) =>
    turf.buffer(turf.point([p.lng, p.lat]), radiusKm, { units: 'kilometers', steps: 2 })
  )

  // 过滤掉无效的缓冲区
  // 验证坐标数组长度
  const validBuffers = buffers.filter(
    (b) => b && b.geometry && b.geometry.coordinates && b.geometry.coordinates.length > 0
  )
  if (validBuffers.length === 0) {
    logger.debug('没有有效的缓冲区')
    return null
  }

  if (validBuffers.length === 1) return validBuffers[0]

  try {
    const unionResult = unionDivide(validBuffers)
    // 验证 union 结果，处理 MultiPolygon 情况
    if (!unionResult || !unionResult.geometry) {
      logger.debug('union 返回无效结果')
      return null
    }

    // 如果返回 MultiPolygon，保留所有 Polygon 作为覆盖区域
    // 返回第一个 Polygon 作为主覆盖区域，但记录所有 Polygon 的坐标
    if (unionResult.geometry.type === 'MultiPolygon') {
      logger.debug('turf.union 返回 MultiPolygon，保留所有 Polygon')
      // 返回完整的 MultiPolygon，而不是只返回第一个
      return unionResult
    }

    return unionResult
  } catch (error) {
    logger.error('turf.union 失败:', error.message, '缓冲区数量:', validBuffers.length)
    // 降级契约：union 异常返回 null——调用方（buildTypeCoverage）对 null 视为
    // "该类型覆盖缺失"走空覆盖分支，不中断整个选址流程（intersectCoverages 同样容忍 null）
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
        logger.debug(`无效的几何对象，跳过 ${entries[i].key}`)
        continue
      }

      const intersectResult = turf.intersect(turf.featureCollection([result, entries[i].coverage]))

      if (!intersectResult || !intersectResult.geometry) {
        return { area: null, failKey: entries[i].key }
      }

      result = intersectResult
    } catch (error) {
      logger.error(`turf.intersect 失败 (${entries[i].key}):`, error.message)
      return { area: null, failKey: entries[i].key }
    }
  }

  return { area: result, failKey: null }
}
export function filterMatchedXiaoqu(xiaoquData, finalArea, spatialIndex = null) {
  // 检查 xiaoquData 是否为空或 null
  if (!xiaoquData || xiaoquData.length === 0) {
    logger.debug('小区数据为空')
    return []
  }

  const candidates = spatialIndex ? queryByPolygon(spatialIndex, finalArea) : xiaoquData

  // 验证 GeoJSON Feature 完整性
  return candidates.filter((xq) => {
    // 检查必要字段
    if (!xq || typeof xq.lng !== 'number' || typeof xq.lat !== 'number') {
      logger.debug('小区数据缺少坐标字段:', xq)
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
      logger.debug('小区坐标无效:', xq)
      return false
    }
    // 检查坐标是否在北部湾业务区域内（经度 105-115，纬度 18-25）
    if (xq.lng < 105 || xq.lng > 115 || xq.lat < 18 || xq.lat > 25) {
      logger.debug('小区坐标不在北部湾业务区域内:', xq)
      return false
    }
    try {
      return turf.booleanPointInPolygon(turf.point([xq.lng, xq.lat]), finalArea)
    } catch (error) {
      logger.debug('空间判断失败:', error.message, xq)
      return false
    }
  })
}
export function rankXiaoqu(matched, facilityData, radiusSettings, weights) {
  const scored = scoreXiaoqu(matched, facilityData, radiusSettings, weights, linearDecay)
  return scored.sort((a, b) => b.score - a.score).slice(0, TOP_N)
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
  const facilityPoi = {}
  selectedKeys.forEach((key) => {
    facilityPoi[key] = extractValidPoi(facilityData[key])
  })

  return { error: null, coverage: finalArea, matchedXiaoqu: top, facilityPoi }
}

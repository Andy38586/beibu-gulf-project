import * as turf from '@turf/turf'
import { scoreXiaoqu } from './useScoring'
import { linearDecay } from './decayFunctions'
import { importanceToRadius } from './importanceMapping'

const TOP_N = 10

// 校验：至少选了一个类型。返回 null 表示通过，否则返回错误文字
export function validateSelection(selectedKeys) {
  if (selectedKeys.length === 0) {
    return '请至少选择一种设施类型'
  }
  return null
}

// 把 typeSettings(选中状态+重要程度) 换算成实际可用的半径配置
// 输出: { hospital: { selected: true, radius: 3.5 }, ... }
export function resolveRadiusSettings(selectedKeys, typeSettings) {
  const resolved = {}
  selectedKeys.forEach((key) => {
    const setting = typeSettings[key]
    const radius = importanceToRadius(setting.defaultRadius, setting.importance)
    resolved[key] = { selected: true, radius }
  })
  return resolved
}

// 单个类型：把该类型下所有点位各自做缓冲区，再合并成一个整体覆盖面
export function buildTypeCoverage(points, radiusKm) {
  if (!points || points.length === 0) return null
  const buffers = points.map((p) =>
    turf.buffer(turf.point([p.lng, p.lat]), radiusKm, { units: 'kilometers' }),
  )
  if (buffers.length === 1) return buffers[0]
  return turf.union(turf.featureCollection(buffers))
}

// 多个类型的覆盖面，两两求交集，得到"同时满足所有条件"的最终范围
export function intersectCoverages(coverages) {
  const valid = coverages.filter(Boolean)
  if (valid.length === 0) return null

  let result = valid[0]
  for (let i = 1; i < valid.length; i++) {
    result = turf.intersect(turf.featureCollection([result, valid[i]]))
    if (!result) return null
  }
  return result
}

// 筛选落在最终范围内的小区
export function filterMatchedXiaoqu(xiaoquData, finalArea) {
  return xiaoquData.filter((xq) =>
    turf.booleanPointInPolygon(turf.point([xq.lng, xq.lat]), finalArea),
  )
}

// 打分 + 排序 + 取前N
export function rankXiaoqu(matched, facilityData, radiusSettings, weights) {
  const scored = scoreXiaoqu(matched, facilityData, radiusSettings, weights, linearDecay)
  return scored.sort((a, b) => b.score - a.score).slice(0, TOP_N)
}

/**
 * 整合以上所有步骤的主流程，BufferControl.vue 只需要调用这一个函数
 * 返回 { error, coverage, matchedXiaoqu }
 */
export function runSiteAnalysis({ selectedKeys, typeSettings, facilityData, xiaoquData, weights }) {
  const validationError = validateSelection(selectedKeys)
  if (validationError) {
    return { error: validationError, coverage: null, matchedXiaoqu: [] }
  }

  const radiusSettings = resolveRadiusSettings(selectedKeys, typeSettings)

  const coverages = selectedKeys.map((key) =>
    buildTypeCoverage(facilityData[key], radiusSettings[key].radius),
  )

  const finalArea = intersectCoverages(coverages)
  if (!finalArea) {
    return {
      error: '所选设施的覆盖范围没有重叠区域，没有符合条件的小区',
      coverage: null,
      matchedXiaoqu: [],
    }
  }

  const matched = filterMatchedXiaoqu(xiaoquData, finalArea)
  const top = rankXiaoqu(matched, facilityData, radiusSettings, weights)

  return { error: null, coverage: finalArea, matchedXiaoqu: top }
}

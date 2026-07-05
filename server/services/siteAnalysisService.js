import * as turf from '@turf/turf'
import { scoreXiaoqu, DEFAULT_WEIGHTS } from './scoringService.js'
import { linearDecay } from './decayFunctions.js'
import { importanceToRadius } from './importanceMapping.js'
import { createSpatialIndex, queryByPolygon } from '../utils/spatialIndex.js'

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
    resolved[key] = { selected: true, radius }
  })
  return resolved
}
export function buildTypeCoverage(points, radiusKm) {
  if (!points || points.length === 0) return null
  const buffers = points.map((p) =>
    turf.buffer(turf.point([p.lng, p.lat]), radiusKm, { units: 'kilometers' }),
  )
  if (buffers.length === 1) return buffers[0]
  return turf.union(turf.featureCollection(buffers))
}
export function intersectCoverages(coverages, selectedKeys) {
  const entries = coverages
    .map((c, i) => ({ key: selectedKeys[i], coverage: c }))
    .filter((e) => e.coverage)
  if (entries.length === 0) return { area: null, failKey: null }
  let result = entries[0].coverage
  for (let i = 1; i < entries.length; i++) {
    result = turf.intersect(turf.featureCollection([result, entries[i].coverage]))
    if (!result) return { area: null, failKey: entries[i].key }
  }
  return { area: result, failKey: null }
}
export function filterMatchedXiaoqu(xiaoquData, finalArea, spatialIndex = null) {
  const candidates = spatialIndex ? queryByPolygon(spatialIndex, finalArea) : xiaoquData
  return candidates.filter((xq) =>
    turf.booleanPointInPolygon(turf.point([xq.lng, xq.lat]), finalArea),
  )
}
export function rankXiaoqu(matched, facilityData, radiusSettings, weights) {
  const scored = scoreXiaoqu(matched, facilityData, radiusSettings, weights, linearDecay)
  return scored.sort((a, b) => b.score - a.score).slice(0, TOP_N)
}
export function runSiteAnalysis({
  selectedKeys,
  typeSettings,
  facilityData,
  xiaoquData,
  weights = DEFAULT_WEIGHTS,
}) {
  const validationError = validateSelection(selectedKeys)
  if (validationError) {
    return { error: validationError, coverage: null, matchedXiaoqu: [] }
  }

  const radiusSettings = resolveRadiusSettings(selectedKeys, typeSettings)

  const coverages = selectedKeys.map((key) =>
    buildTypeCoverage(facilityData[key], radiusSettings[key].radius),
  )

  const { area: finalArea, failKey } = intersectCoverages(coverages, selectedKeys)
  if (!finalArea) {
    return {
      error: `${failKey} 的覆盖范围与其他类型无重叠区域`,
      coverage: null,
      matchedXiaoqu: [],
    }
  }
  const spatialIndex = createSpatialIndex(xiaoquData)
  const matched = filterMatchedXiaoqu(xiaoquData, finalArea, spatialIndex)
  const top = rankXiaoqu(matched, facilityData, radiusSettings, weights)

  return { error: null, coverage: finalArea, matchedXiaoqu: top }
}

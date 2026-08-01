import * as turf from '@turf/turf'
import RBush from 'rbush'
import { linearDecay } from './decayFunctions.js'

export const DEFAULT_WEIGHTS = {
  hospital: 1.2,
  primary_school: 1.0,
  middle_school: 1.0,
  park: 0.8,
  bus_station: 0.6,
  mall: 0.7,
}

/**
 * 为设施点集构建 rbush 空间索引（d047：替代 O(n²) 全量遍历）
 * @param {Array<{lng:number,lat:number}>} points
 * @returns {RBush}
 */
function buildFacilityIndex(points) {
  const tree = new RBush()
  const items = points.map((p) => ({
    minX: p.lng,
    minY: p.lat,
    maxX: p.lng,
    maxY: p.lat,
    data: p,
  }))
  tree.load(items)
  return tree
}

/**
 * 经纬度偏移量估算（1km ≈ 0.009° 纬度，经度随纬度变化）
 */
function kmToDegreeOffset(km, lat) {
  const latOffset = km / 111
  const lngOffset = km / (111 * Math.cos((lat * Math.PI) / 180) || 1)
  return { latOffset, lngOffset }
}
function distanceScore(xq, facilityIndex, maxDistanceKm, decayFn) {
  if (!facilityIndex || facilityIndex.isEmpty?.()) return 0

  // bbox 粗筛：只检索 maxDistance 范围内的候选点
  const { latOffset, lngOffset } = kmToDegreeOffset(maxDistanceKm, xq.lat)
  const candidates = facilityIndex.search({
    minX: xq.lng - lngOffset,
    minY: xq.lat - latOffset,
    maxX: xq.lng + lngOffset,
    maxY: xq.lat + latOffset,
  })

  if (candidates.length === 0) return decayFn(maxDistanceKm, maxDistanceKm)

  // 精确距离计算（仅对候选点）
  const xqPoint = turf.point([xq.lng, xq.lat])
  let nearest = Infinity
  for (const c of candidates) {
    const d = turf.distance(xqPoint, turf.point([c.data.lng, c.data.lat]), {
      units: 'kilometers',
    })
    if (d < nearest) nearest = d
  }
  return decayFn(nearest, maxDistanceKm)
}

export function scoreXiaoqu(
  xiaoquList,
  facilityData,
  typeSettings,
  weights = DEFAULT_WEIGHTS,
  decayFn = linearDecay
) {
  // d047: 预构建各设施类型的空间索引，避免每个小区重复遍历
  const facilityIndexes = {}
  for (const key of Object.keys(typeSettings)) {
    const points = facilityData[key]
    if (points && points.length > 0) {
      facilityIndexes[key] = buildFacilityIndex(points)
    }
  }

  return xiaoquList.map((xq) => {
    let totalScore = 0
    let totalWeight = 0
    const breakdown = {}

    Object.entries(typeSettings).forEach(([key, setting]) => {
      if (!setting.selected) return
      const weight = weights[key] ?? 1
      const score = distanceScore(xq, facilityIndexes[key], setting.radius, decayFn)
      breakdown[key] = Math.round(score * 10) / 10
      totalScore += score * weight
      totalWeight += weight
    })
    const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0
    return { ...xq, score: Math.round(finalScore * 10) / 10, breakdown }
  })
}

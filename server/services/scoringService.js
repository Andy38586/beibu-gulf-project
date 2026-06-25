import * as turf from '@turf/turf'
import { linearDecay } from './decayFunctions.js'

export const DEFAULT_WEIGHTS = {
  hospital: 1.2,
  primary_school: 1.0,
  middle_school: 1.0,
  park: 0.8,
  bus_station: 0.6,
  mall: 0.7,
}
function distanceScore(xq, points, maxDistanceKm, decayFn) {
  if (!points || points.length === 0) return 0
  const xqPoint = turf.point([xq.lng, xq.lat])
  const nearest = Math.min(
    ...points.map((p) =>
      turf.distance(xqPoint, turf.point([p.lng, p.lat]), { units: 'kilometers' }),
    ),
  )
  return decayFn(nearest, maxDistanceKm)
}
export function scoreXiaoqu(
  xiaoquList,
  facilityData,
  typeSettings,
  weights = DEFAULT_WEIGHTS,
  decayFn = linearDecay,
) {
  return xiaoquList.map((xq) => {
    let totalScore = 0
    let totalWeight = 0
    const breakdown = {}

    Object.entries(typeSettings).forEach(([key, setting]) => {
      if (!setting.selected) return
      const weight = weights[key] ?? 1
      const score = distanceScore(xq, facilityData[key], setting.radius, decayFn)
      breakdown[key] = Math.round(score * 10) / 10
      totalScore += score * weight
      totalWeight += weight
    })
    const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0
    return { ...xq, score: Math.round(finalScore * 10) / 10, breakdown }
  })
}

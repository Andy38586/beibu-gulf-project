import * as turf from '@turf/turf'
import { linearDecay } from './decayFunctions'
// 默认权重，BufferControl.vue 里会把这个变成 ref，用户以后可以调整
export const DEFAULT_WEIGHTS = {
  hospital: 1.2,
  primary_school: 1.0,
  middle_school: 1.0,
  park: 0.8,
  bus_station: 0.6,
  mall: 0.7,
}
// 算一个小区到某一类设施的"最近距离"对应的得分
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
/**
 * 给小区列表打分，同时保留每个类型的分项得分(breakdown)，供雷达图展示
 * @param {Array} xiaoquList 候选小区列表
 * @param {Object} facilityData 各类设施数据 { hospital: [...], park: [...] }
 * @param {Object} typeSettings 各类型的选中状态和半径 { hospital: {selected, radius} }
 * @param {Object} weights 各类型权重，默认用 DEFAULT_WEIGHTS
 * @param {Function} decayFn 距离衰减算法，默认线性衰减
 */
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
    const breakdown = {} // { hospital: 82.3, park: 60.1, ... } 每类的原始得分(0~100)，不乘权重
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

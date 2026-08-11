import * as turf from '@turf/turf'
import RBush from 'rbush'
import { logger } from '../utils/logger.js'

// 原 decayFunctions / importanceMapping 与本文仅 siteAnalysisService 一处消费，合并避免过细拆分

/** 线性距离衰减：距离 >= maxDistance 得 0 分，否则按比例线性衰减（百分制） */
export const linearDecay = (distance, maxDistance) => {
  if (distance >= maxDistance) return 0
  return (1 - distance / maxDistance) * 100
}

/** 重要程度 → 半径放大系数（1~5 档） */
const IMPORTANCE_FACTOR = {
  1: 0.4,
  2: 0.7,
  3: 1.0,
  4: 1.5,
  5: 2.2,
}

// 非表项输入取整夹取并告警，拒绝静默兜底
function importanceToFactor(importance) {
  const raw = Number(importance)
  const n = Math.round(raw)
  if (!isFinite(raw) || n < 1 || n > 5) {
    logger.warn(`[importanceMapping] 无效 importance: ${importance}，已按 3 处理`)
    return IMPORTANCE_FACTOR[3]
  }
  if (n !== raw) {
    logger.debug(`[importanceMapping] importance ${importance} 非整数，已取整为 ${n}`)
  }
  return IMPORTANCE_FACTOR[n]
}

/** 按重要程度放大默认设施半径 */
export function importanceToRadius(defaultRadius, importance) {
  const factor = importanceToFactor(importance)
  return Math.round(defaultRadius * factor * 10) / 10
}

// ==================== 选址评分核心 ====================

export const DEFAULT_WEIGHTS = {
  hospital: 1.2,
  primary_school: 1.0,
  middle_school: 1.0,
  park: 0.8,
  bus_station: 0.6,
  mall: 0.7,
}

/** 为设施点集构建 rbush 空间索引，避免 O(n²) 全量遍历 */
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
  // 显式分母守卫：浮点 cos(90°)≈6.12e-17 恒非 0，旧 ||1 兜底永不触发 → 极点附近
  // lngOffset 爆炸（~7e14 度）致 bbox 粗筛全量退化 O(n)；|cos|<1e-6 时保守扩张 bbox
  //（粗筛语义=不漏候选，结果仍正确），Number.isFinite 兜住 NaN/Infinity 输入
  const cosLat = Math.cos((lat * Math.PI) / 180)
  const guardedCos = Number.isFinite(cosLat) && Math.abs(cosLat) > 1e-6 ? cosLat : 1e-6
  const lngOffset = km / (111 * guardedCos)
  return { latOffset, lngOffset }
}
function distanceScore(xq, facilityIndex, maxDistanceKm, decayFn) {
  // RBush 无 isEmpty 方法，旧 isEmpty?.() 恒 undefined → !undefined 恒真 → 评分恒 0（功能整体失效）；
  // 改 all() 判空；facilityIndex 为 undefined（该设施类型无数据）走前分支兜底
  if (!facilityIndex || facilityIndex.all().length === 0) return 0

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
  // 预构建各设施类型的空间索引，避免每个小区重复遍历
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

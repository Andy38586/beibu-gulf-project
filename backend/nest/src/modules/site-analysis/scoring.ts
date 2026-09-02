import * as turf from '@turf/turf'
import RBush from 'rbush'

import { DEFAULT_WEIGHTS, IMPORTANCE_FACTOR } from '../../common/constants/scoring.constants'

// 逐行等价移植 backend/services/scoringService.js（选址评分核心）。
// 原 decayFunctions / importanceMapping 与 site-analysis 仅一处消费，合并避免过细拆分。

/** 线性距离衰减：距离 >= maxDistance 得 0 分，否则按比例线性衰减（百分制） */
export const linearDecay = (distance: number, maxDistance: number): number => {
  // 8-9：无效坐标会使 turf.distance 返回 NaN（NaN >= 0 恒 false → 穿透到除法）；
  // 显式守卫，NaN 距离按 0 分处理（02 §5.6 不变量 5：NaN 不传播）
  if (!Number.isFinite(distance) || distance >= maxDistance) return 0
  return (1 - distance / maxDistance) * 100
}

// 非表项输入取整夹取并告警，拒绝静默兜底（Nest Logger 在纯函数层不可用，降为注释口径：
// Express 侧 logger.warn 仅观测用途，不影响返回值——等价性以返回值为准）
function importanceToFactor(importance: unknown): number {
  const raw = Number(importance)
  const n = Math.round(raw)
  if (!Number.isFinite(raw) || n < 1 || n > 5) {
    return IMPORTANCE_FACTOR[3]
  }
  return IMPORTANCE_FACTOR[n]
}

/** 按重要程度放大默认设施半径 */
export function importanceToRadius(defaultRadius: number, importance: unknown): number {
  const factor = importanceToFactor(importance)
  return Math.round(defaultRadius * factor * 10) / 10
}

// ==================== 选址评分核心 ====================

export { DEFAULT_WEIGHTS }

export interface FacilityPoint {
  id?: string
  name?: string
  lng: number
  lat: number
  [key: string]: unknown
}

export interface TypeSetting {
  selected?: boolean
  defaultRadius?: number
  radius?: number
  importance?: number
  [key: string]: unknown
}

interface XqLike extends FacilityPoint {
  score?: number
  breakdown?: Record<string, number>
}

interface FacilityIndexItem {
  minX: number
  minY: number
  maxX: number
  maxY: number
  data: FacilityPoint
}

/** 为设施点集构建 rbush 空间索引，避免 O(n²) 全量遍历；8-4：无效坐标点跳过不索引 */
function buildFacilityIndex(points: FacilityPoint[]): RBush<FacilityIndexItem> {
  const tree = new RBush<FacilityIndexItem>()
  const items: FacilityIndexItem[] = []
  for (const p of points) {
    if (!Number.isFinite(p?.lng) || !Number.isFinite(p?.lat)) {
      continue
    }
    items.push({
      minX: p.lng,
      minY: p.lat,
      maxX: p.lng,
      maxY: p.lat,
      data: p,
    })
  }
  tree.load(items)
  return tree
}

/**
 * 经纬度偏移量估算（1km ≈ 0.009° 纬度，经度随纬度变化）。
 * 粗筛 bbox 保守化：经度偏移按纬度区间 [lat±latOffset] 内的最小 cos 计算
 * （高纬一侧 cos 更小 → 偏移更大 → 真近点必然落入 bbox，不漏候选）
 */
export function kmToDegreeOffset(
  km: number,
  lat: number
): { latOffset: number; lngOffset: number } {
  const latOffset = km / 111
  // 显式分母守卫：浮点 cos(90°)≈6.12e-17 恒非 0，旧 ||1 兜底永不触发 → 极点附近
  // lngOffset 爆炸（~7e14 度）致 bbox 粗筛全量退化 O(n)；|cos|<1e-6 时保守扩张 bbox
  //（粗筛语义=不漏候选，结果仍正确），Number.isFinite 兜住 NaN/Infinity 输入
  const cosMin = Math.min(
    Math.cos(((lat - latOffset) * Math.PI) / 180),
    Math.cos(((lat + latOffset) * Math.PI) / 180)
  )
  // 取 |cos|：纬度区间跨过 ±90° 时 cos 变负，偏移必须始终为正（保守扩张）
  const cosAbs = Math.abs(cosMin)
  const guardedCos = Number.isFinite(cosAbs) && cosAbs > 1e-6 ? cosAbs : 1e-6
  const lngOffset = km / (111 * guardedCos)
  return { latOffset, lngOffset }
}

function distanceScore(
  xq: XqLike,
  facilityIndex: RBush<FacilityIndexItem> | undefined,
  maxDistanceKm: number,
  decayFn: (distance: number, maxDistance: number) => number
): number {
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

  // 无候选 → 硬 0 分（02 §4.1「某类型无设施 → 该因子 0 分」语义）。
  // 原 decayFn(max,max) 仅对 linearDecay 恒等 0，自定义衰减函数（如指数）会返回非零（历史实锤 ~36.8），
  // 属防御语义隐含依赖；生产固定 linearDecay 不触发，此处显式分离「无设施/越界衰减」语义
  if (candidates.length === 0) return 0

  // 精确距离计算（仅对候选点）
  const xqPoint = turf.point([xq.lng, xq.lat])
  let nearest = Infinity
  for (const c of candidates) {
    const d = turf.distance(xqPoint, turf.point([c.data.lng, c.data.lat]), { units: 'kilometers' })
    if (d < nearest) nearest = d
  }
  return decayFn(nearest, maxDistanceKm)
}

export function scoreXiaoqu(
  xiaoquList: XqLike[],
  facilityData: Record<string, FacilityPoint[] | null | undefined>,
  typeSettings: Record<string, TypeSetting>,
  weights: Record<string, number> = DEFAULT_WEIGHTS,
  decayFn: (distance: number, maxDistance: number) => number = linearDecay
): XqLike[] {
  // 预构建各设施类型的空间索引，避免每个小区重复遍历
  const facilityIndexes: Record<string, RBush<FacilityIndexItem>> = {}
  for (const key of Object.keys(typeSettings)) {
    const points = facilityData[key]
    if (points && points.length > 0) {
      facilityIndexes[key] = buildFacilityIndex(points)
    }
  }

  return xiaoquList.map((xq) => {
    let totalScore = 0
    let totalWeight = 0
    const breakdown: Record<string, number> = {}

    // 8-4：小区坐标无效时整条评分链产出 NaN（bbox 粗筛退化 + turf.distance NaN）；
    // 无效小区按 0 分计，不静默传播 NaN
    if (!Number.isFinite(xq?.lng) || !Number.isFinite(xq?.lat)) {
      // breakdown 与正常路径同构：前端雷达图按类型键取值（breakdown?.[key] ?? 0），
      // 空对象虽不崩但形状分裂；单测契约锁定各因子恒为有限值
      const zeroBreakdown: Record<string, number> = {}
      Object.entries(typeSettings).forEach(([key, setting]) => {
        if (setting.selected) zeroBreakdown[key] = 0
      })
      return { ...xq, score: 0, breakdown: zeroBreakdown }
    }

    Object.entries(typeSettings).forEach(([key, setting]) => {
      if (!setting.selected) return
      const weight = weights[key] ?? 1
      const score = distanceScore(xq, facilityIndexes[key], setting.radius as number, decayFn)
      breakdown[key] = Math.round(score * 10) / 10
      totalScore += score * weight
      totalWeight += weight
    })
    const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0
    return { ...xq, score: Math.round(finalScore * 10) / 10, breakdown }
  })
}

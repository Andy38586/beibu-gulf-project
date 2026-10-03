import { BusinessError, ErrorCode } from '../../../common/errors/business-error'
import {
  accessScore,
  inundationScore,
  LAND_CLASS_SCORE,
  terrainScore,
} from '../constants/score.constants'
// 适宜性评分纯函数（单元四）：子因子归一化（score.constants）→ 加权和。
// 勘误#5 口径：预物化准则面在库（suitability_cells），端点只做归一化+加权和。
// 权重由端点入参给定（AHP 定稿前前端可调滑块），和≠1 拒收。

export interface SuitabilityWeights {
  inundation: number
  terrain: number
  land: number
  access: number
  demand: number
}

const WEIGHT_KEYS = ['inundation', 'terrain', 'land', 'access', 'demand'] as const

/** 权重校验：五键齐全、有限、∈[0,1]、和=1（容差 1e-6）——不过直接抛错拒收 */
export function parseWeights(raw: Record<string, unknown>): SuitabilityWeights {
  const out = {} as SuitabilityWeights
  let sum = 0
  for (const k of WEIGHT_KEYS) {
    const v = Number(raw[k])
    if (!Number.isFinite(v) || v < 0 || v > 1) {
      throw new BusinessError(
        ErrorCode.INVALID_PARAMS,
        `权重 ${k}=${String(raw[k])} 非法（须 ∈ [0,1] 且有限）`
      )
    }
    out[k] = v
    sum += v
  }
  if (Math.abs(sum - 1) > 1e-6) {
    throw new BusinessError(ErrorCode.INVALID_PARAMS, `权重和 = ${sum} ≠ 1，拒收`)
  }
  return out
}

/** 库行形状（suitability_cells 子集；land_class/kde_mass 可空=缺因子口径） */
export interface FactorCell {
  id: number
  meanElevM: number
  meanSlopeDeg: number
  landFrac: number
  landClass: number | null
  distPortM: number
  distRoadM: number
  kdeMass: number | null
}

export interface CellScore {
  id: number
  score: number
  sub: SuitabilityWeights
}

/** 需求子分数的分母：kde 质量的 99 分位（防离群点把全场压扁），调用方一次算好传入 */
export function demandScore(kdeMass: number, kdeP99: number): number {
  if (kdeP99 <= 0) return 0
  return Math.min(1, kdeMass / kdeP99)
}

/**
 * 单格适宜性 = Σ w_i·s_i。缺因子口径：land_class 为 null（WorldCover 空洞）⇒
 * land 子分按 0.5 中性值并打 flat 标（宁中性不编造，04-B7）；kde_mass 为 null
 * （园区 3h 辐射外）⇒ demand 子分按 0（无产业密度证据）。
 */
export function cellScore(cell: FactorCell, w: SuitabilityWeights, kdeP99: number): CellScore {
  const sInundation = inundationScore(cell.meanElevM)
  const sTerrain = terrainScore(cell.meanSlopeDeg)
  const sLand = cell.landClass != null ? (LAND_CLASS_SCORE[cell.landClass] ?? 0.5) : 0.5
  const sAccess = accessScore(cell.distPortM, cell.distRoadM)
  const sDemand = cell.kdeMass != null ? demandScore(cell.kdeMass, kdeP99) : 0
  const score =
    w.inundation * sInundation +
    w.terrain * sTerrain +
    w.land * sLand +
    w.access * sAccess +
    w.demand * sDemand
  return {
    id: cell.id,
    score: Math.round(score * 10000) / 10000,
    sub: {
      inundation: Math.round(sInundation * 10000) / 10000,
      terrain: Math.round(sTerrain * 10000) / 10000,
      land: Math.round(sLand * 10000) / 10000,
      access: Math.round(sAccess * 10000) / 10000,
      demand: Math.round(sDemand * 10000) / 10000,
    },
  }
}

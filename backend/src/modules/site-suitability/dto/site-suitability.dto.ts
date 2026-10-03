// 加权叠加端点入参解析（单元四）：五准则权重经 query 传入（GET 语义：可缓存可分享），
// 缺省回落 AHP 定稿矩阵的特征向量权重（SITE_AHP_MATRIX，2026-09-30 定稿，
// 依据链见 site-ahp.constants.ts 文件头）。
import { ahpWeights } from '../../../common/ahp'
import { SITE_AHP_MATRIX, SITE_CRITERIA } from '../../../common/constants/site-ahp.constants'
import { BusinessError, ErrorCode } from '../../../common/errors/business-error'

export interface SuitabilityQuery {
  weights: Record<string, number>
  minLandFrac: number
  /** 聚合分辨率（度）。0 = 全分辨率（默认，保持既有消费方行为）；>0 = 按该边长的粗格聚合 */
  resolution: number
}

/** AHP 定稿特征向量权重（顺序对应 SITE_CRITERIA：浸没/地形/土地/可达/需求） */
export function defaultWeights(): Record<string, number> {
  const { weights } = ahpWeights(SITE_AHP_MATRIX)
  return Object.fromEntries(SITE_CRITERIA.map((k, i) => [CRITERION_KEY[k] ?? k, weights[i]]))
}

// 中文准则标签 → 入参键（与 parseWeights 五键对齐）
const CRITERION_KEY: Record<string, string> = {
  浸没风险: 'inundation',
  高程地形: 'terrain',
  土地适宜: 'land',
  交通可达: 'access',
  需求引力: 'demand',
}

const WEIGHT_KEYS = ['inundation', 'terrain', 'land', 'access', 'demand'] as const

export function parseSuitabilityQuery(query: Record<string, unknown>): SuitabilityQuery {
  const weights: Record<string, number> = {}
  let anyGiven = false
  for (const k of WEIGHT_KEYS) {
    const raw = query[`w_${k}`]
    if (raw !== undefined && raw !== '') {
      anyGiven = true
      const v = Number(raw)
      if (!Number.isFinite(v)) throw new BusinessError(ErrorCode.INVALID_PARAMS, `w_${k} 非数值`)
      weights[k] = v
    }
  }
  if (!anyGiven) {
    return {
      weights: defaultWeights(),
      minLandFrac: parseMinLandFrac(query.min_land_frac),
      resolution: parseResolution(query.resolution),
    }
  }
  for (const k of WEIGHT_KEYS) {
    if (weights[k] === undefined) weights[k] = 0
  }
  return {
    weights,
    minLandFrac: parseMinLandFrac(query.min_land_frac),
    resolution: parseResolution(query.resolution),
  }
}

/**
 * 聚合分辨率解析（性能治本，2026-10-02）：全量 14 万格 ≈ 28.8MB 响应，浏览器解析即卡。
 * 渲染热力图不需要原始格 ⇒ 允许按要求聚合。0（缺省）= 全分辨率；上限 1°（再粗无意义）。
 */
function parseResolution(raw: unknown): number {
  if (raw === undefined || raw === '') return 0
  const v = Number(raw)
  if (!Number.isFinite(v) || v < 0 || v > 1)
    throw new BusinessError(ErrorCode.INVALID_PARAMS, 'resolution 须 ∈ (0,1]，或 0 表示全分辨率')
  return v
}

function parseMinLandFrac(raw: unknown): number {
  if (raw === undefined || raw === '') return 0.5
  const v = Number(raw)
  if (!Number.isFinite(v) || v < 0 || v > 1) {
    throw new BusinessError(ErrorCode.INVALID_PARAMS, 'min_land_frac 须 ∈ [0,1]')
  }
  return v
}

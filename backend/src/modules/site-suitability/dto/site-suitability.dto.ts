// 加权叠加端点入参解析（单元四）：五准则权重经 query 传入（GET 语义：可缓存可分享），
// 缺省回落 AHP 草案矩阵的特征向量权重——**AHP 定稿前草案权重即默认值**（site-ahp
// 头部警告闸仍生效：定稿后替换此处来源）。
import { ahpWeights } from '../../../common/ahp'
import { SITE_AHP_DRAFT_MATRIX, SITE_CRITERIA } from '../../../common/constants/site-ahp.constants'

export interface SuitabilityQuery {
  weights: Record<string, number>
  minLandFrac: number
}

/** AHP 草案特征向量权重（顺序对应 SITE_CRITERIA：浸没/地形/土地/可达/需求） */
export function defaultWeights(): Record<string, number> {
  const { weights } = ahpWeights(SITE_AHP_DRAFT_MATRIX)
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
      if (!Number.isFinite(v)) throw new Error(`w_${k} 非数值`)
      weights[k] = v
    }
  }
  if (!anyGiven) {
    return { weights: defaultWeights(), minLandFrac: parseMinLandFrac(query.min_land_frac) }
  }
  for (const k of WEIGHT_KEYS) {
    if (weights[k] === undefined) weights[k] = 0
  }
  return { weights, minLandFrac: parseMinLandFrac(query.min_land_frac) }
}

function parseMinLandFrac(raw: unknown): number {
  if (raw === undefined || raw === '') return 0.5
  const v = Number(raw)
  if (!Number.isFinite(v) || v < 0 || v > 1) throw new Error('min_land_frac 须 ∈ [0,1]')
  return v
}

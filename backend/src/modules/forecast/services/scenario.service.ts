import { BusinessError, ErrorCode } from '../../../common/errors/business-error'

import {
  CANAL_INTERVAL_ANCHORS,
  CANAL_PORT_SHARES,
  CANAL_SCENARIOS,
  type CanalScenarioDef,
} from '../constants/scenario.constants'

// 运河情景变换（纯函数，零 I/O）：基线预测点 + 情景锚点 → 叠加江海联运增量后的预测点。
// 语义（04-B10 可复算）：月度增量 = 运河年运量(锚点插值) × 江海联运占比 × 港域分摊 ÷ 12。
// 历史段永不修改；reliability 保持基线口径（情景间的不确定性由情景选择本身表达，见开工档 §四）。

export type ScenarioId = 'baseline' | CanalScenarioDef['id']

const SCENARIO_DEFS = new Map<string, CanalScenarioDef>(CANAL_SCENARIOS.map((s) => [s.id, s]))

/** 入参归一：空/缺省 → baseline；非法值抛业务错误（对外文案是契约，不与 DTO 校验重复展开） */
export function parseScenarioId(raw: unknown): ScenarioId {
  if (raw === undefined || raw === null || raw === '') return 'baseline'
  const v = String(raw)
  if (v === 'baseline') return 'baseline'
  if (SCENARIO_DEFS.has(v)) return v as Exclude<ScenarioId, 'baseline'>
  throw new BusinessError(ErrorCode.INVALID_PARAMS, `未知运河情景: ${v}`)
}

/** 'YYYY-MM' | 'YYYY-MM-DD' → 年份小数（月中点口径，全域唯一时间解析入口，04-B5） */
export function timeToYearFloat(time: string): number {
  const [y, m] = time.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    throw new BusinessError(ErrorCode.INVALID_PARAMS, `无法解析的预测时间: ${time}`)
  }
  return y + (m - 0.5) / 12
}

/** 锚点分段线性插值：首锚点前取 0（运河未通航），末锚点后持平（不外推发散） */
function interpolate(anchors: Array<[number, number]>, x: number): number {
  if (x <= anchors[0][0]) return anchors[0][1]
  const last = anchors[anchors.length - 1]
  if (x >= last[0]) return last[1]
  for (let i = 1; i < anchors.length; i++) {
    const [x1, v1] = anchors[i]
    const [x0, v0] = anchors[i - 1]
    if (x <= x1) return v0 + ((x - x0) / (x1 - x0)) * (v1 - v0)
  }
  return last[1]
}

/** 江海联运占比 = (总运量 − 区间运量) / 总运量；总运量 ≤ 0 时无增量可言，返回 0 */
function seaLegRatioAt(def: CanalScenarioDef, yearFloat: number): number {
  const total = interpolate(def.anchors, yearFloat)
  if (total <= 0) return 0
  const interval = interpolate(CANAL_INTERVAL_ANCHORS, yearFloat)
  return Math.min(1, Math.max(0, (total - interval) / total))
}

/** 变换点形态约束（仅本模块泛形用，不外暴——冗余导出棘轮 110 上限） */
interface ScenarioUpliftPoint {
  time: string
  value: number
  lower?: number
  upper?: number
}

/**
 * 对单港预测点序列叠加运河情景增量（预测段专属；月度增量 = 年增量 ÷ 12）。
 * baseline 原样返回；未知情景/未知港域显式抛错——静默返回基线等于把口径错误藏进缓存（04-B8）。
 */
export function applyCanalScenario<T extends ScenarioUpliftPoint>(
  portId: string,
  points: T[],
  scenarioId: ScenarioId
): T[] {
  if (scenarioId === 'baseline') return points
  const def = SCENARIO_DEFS.get(scenarioId)
  if (!def) throw new BusinessError(ErrorCode.INVALID_PARAMS, `未知运河情景: ${scenarioId}`)
  const share = CANAL_PORT_SHARES[portId]
  if (!share) {
    throw new BusinessError(ErrorCode.INVALID_PARAMS, `港域无运河分摊参数: ${portId}`)
  }

  return points.map((p) => {
    const t = timeToYearFloat(p.time)
    const annual = interpolate(def.anchors, t)
    if (!(annual > 0)) return p
    const add = (annual * seaLegRatioAt(def, t) * share) / 12
    return {
      ...p,
      value: Math.round(p.value + add),
      ...(p.lower !== undefined ? { lower: Math.round(p.lower + add) } : {}),
      ...(p.upper !== undefined ? { upper: Math.round(p.upper + add) } : {}),
    }
  })
}

export function scenarioLabel(scenarioId: ScenarioId): string {
  if (scenarioId === 'baseline') return '基线（无运河）'
  return SCENARIO_DEFS.get(scenarioId)?.label ?? scenarioId
}

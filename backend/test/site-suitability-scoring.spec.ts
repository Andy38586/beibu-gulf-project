import { describe, expect, it } from 'vitest'

import { BusinessError } from '../src/common/errors/business-error'
import {
  accessScore,
  inundationScore,
  LAND_CLASS_SCORE,
  terrainScore,
} from '../src/modules/site-suitability/constants/score.constants'
import {
  defaultWeights,
  parseSuitabilityQuery,
} from '../src/modules/site-suitability/dto/site-suitability.dto'
import {
  cellScore,
  demandScore,
  parseWeights,
} from '../src/modules/site-suitability/services/scoring'

// 适宜性评分单测（单元四）。oracle 全部按 constants 分段定义手工复算。

const BASE_CELL = {
  id: 1,
  meanElevM: 10,
  meanSlopeDeg: 1,
  landFrac: 1,
  landClass: 50,
  distPortM: 0,
  distRoadM: 0,
  kdeMass: 0,
}
const EQ_W = { inundation: 0.2, terrain: 0.2, land: 0.2, access: 0.2, demand: 0.2 }

describe('parseWeights 拒收（阴性）', () => {
  it('和≠1 / 越界 / 非有限 全部抛错', () => {
    expect(() =>
      parseWeights({ inundation: 0.6, terrain: 0.2, land: 0.2, access: 0.2, demand: 0.2 })
    ).toThrow(/权重和/)
    expect(() =>
      parseWeights({ inundation: 1.2, terrain: -0.2, land: 0, access: 0, demand: 0 })
    ).toThrow(/非法/)
    expect(() =>
      parseWeights({ inundation: NaN, terrain: 0.2, land: 0.2, access: 0.2, demand: 0.2 })
    ).toThrow(/非法/)
    const ok = parseWeights({ inundation: 0.2, terrain: 0.2, land: 0.2, access: 0.2, demand: 0.2 })
    expect(ok.inundation).toBe(0.2)
  })
})

describe('子分数单调性（手工复算 oracle）', () => {
  it('浸没适宜度随高程升：≤1m=0.05，6m=1，3.5m=0.4775（线性段中点）', () => {
    expect(inundationScore(0.5)).toBeCloseTo(0.05, 12)
    expect(inundationScore(6)).toBe(1)
    expect(inundationScore(10)).toBe(1)
    expect(inundationScore(3.5)).toBeCloseTo(0.05 + (2.5 / 5) * 0.95, 12)
    expect(inundationScore(5)).toBeGreaterThan(inundationScore(2))
  })
  it('地形适宜度随坡度降（刘文分级锚）：≤5°=1，≥20°=0.1，9°=0.76', () => {
    expect(terrainScore(1)).toBe(1)
    expect(terrainScore(5)).toBe(1)
    expect(terrainScore(20)).toBe(0.1)
    expect(terrainScore(30)).toBe(0.1)
    // 手工复算：1 − (9−5)/15 × 0.9 = 1 − 0.24 = 0.76
    expect(terrainScore(9)).toBeCloseTo(0.76, 12)
    expect(terrainScore(10)).toBeLessThan(terrainScore(6))
  })
  it('可达适宜度随距离降：0=1，远港远路→趋 0（指数衰减）', () => {
    expect(accessScore(0, 0)).toBeCloseTo(1, 12)
    expect(accessScore(8000, 2000)).toBeCloseTo(0.6 / Math.E + 0.4 / Math.E, 12)
    expect(accessScore(50000, 50000)).toBeLessThan(0.05)
    expect(accessScore(1000, 0)).toBeLessThan(accessScore(0, 0))
  })
  it('土地类分序：人造(50) > 耕地(40) > 林地(10) > 红树林(95) ≥ 水体(80)（临港口径）', () => {
    expect(LAND_CLASS_SCORE[50]).toBeGreaterThan(LAND_CLASS_SCORE[40])
    expect(LAND_CLASS_SCORE[40]).toBeGreaterThan(LAND_CLASS_SCORE[10])
    expect(LAND_CLASS_SCORE[10]).toBeGreaterThan(LAND_CLASS_SCORE[95])
    expect(LAND_CLASS_SCORE[80]).toBe(0)
  })
  it('需求归一：kde=99 分位→1，超界钳 1；分母 0→0', () => {
    expect(demandScore(5, 5)).toBe(1)
    expect(demandScore(50, 5)).toBe(1)
    expect(demandScore(2.5, 5)).toBe(0.5)
    expect(demandScore(1, 0)).toBe(0)
  })
})

describe('cellScore 加权和', () => {
  it('等权满分格（人造地表/平地/零距/99 分位 KDE）→ score=1', () => {
    const r = cellScore({ ...BASE_CELL, kdeMass: 10 }, EQ_W, 10)
    expect(r.score).toBe(1)
  })
  it('缺因子口径：land_class=null → land 子分中性 0.5；kde=null → demand=0', () => {
    const r = cellScore(
      { ...BASE_CELL, landClass: null, kdeMass: null },
      { inundation: 0, terrain: 0, land: 1, access: 0, demand: 0 },
      10
    )
    expect(r.sub.land).toBe(0.5)
    const r2 = cellScore(
      { ...BASE_CELL, landClass: null, kdeMass: null },
      { inundation: 0, terrain: 0, land: 0, access: 0, demand: 1 },
      10
    )
    expect(r2.sub.demand).toBe(0)
  })
  it('权重全 0 非法——单准则=1 其余 0 时 score=该准则子分', () => {
    const r = cellScore(BASE_CELL, { inundation: 1, terrain: 0, land: 0, access: 0, demand: 0 }, 10)
    expect(r.score).toBeCloseTo(inundationScore(10), 9)
  })
})

describe('DTO 缺省与解析', () => {
  it('无 w_* 参数 → 回落 AHP 草案特征向量（和=1）', () => {
    const q = parseSuitabilityQuery({})
    const sum = Object.values(q.weights).reduce((a, b) => a + b, 0)
    expect(Math.abs(sum - 1)).toBeLessThan(1e-6)
    // 草案定性序：浸没权重最大（安全门槛型）
    expect(q.weights.inundation).toBe(Math.max(...Object.values(q.weights)))
    expect(q.minLandFrac).toBe(0.5)
  })
  it('部分给定补 0：w_inundation=1 → 其余 0；min_land_frac 越界拒收', () => {
    const q = parseSuitabilityQuery({ w_inundation: '1' })
    expect(q.weights.inundation).toBe(1)
    expect(q.weights.terrain).toBe(0)
    expect(() => parseSuitabilityQuery({ w_inundation: '1', min_land_frac: '2' })).toThrow(
      /min_land_frac/
    )
  })
  it('defaultWeights 与 parseWeights 联动：AHP 特征向量通过权重校验', () => {
    expect(() => parseWeights(defaultWeights())).not.toThrow()
  })
})

// ── 错误分级（专项3 TS-1002-01 与专项8 W6-01 同解，2026-10-03）───────────────
// 修前：五处裸 `throw new Error` ⇒ 全局过滤器落到"未捕获异常"分支 ⇒ HTTP 500
// （用户拖滑块即 500）。修后：统一 BusinessError(ErrorCode.INVALID_PARAMS=400001, status 400)。
// 本块钉"抛出的类与码"；HTTP 层那一格由 site-suitability-input.e2e-spec.ts 实跑。
function caughtError(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  return null
}

describe('site-suitability 入参非法 ⇒ BusinessError(400001)', () => {
  it('DTO：非数值权重 / resolution 越界 / min_land_frac 越界', () => {
    for (const q of [{ w_inundation: 'abc' }, { resolution: '2' }, { min_land_frac: '-1' }]) {
      const e = caughtError(() => parseSuitabilityQuery(q)) as BusinessError
      expect(e).toBeInstanceOf(BusinessError)
      expect(e.status).toBe(400)
      expect(e.bizCode).toBe(400001)
    }
  })

  it('scoring：权重越界 / 权重和≠1', () => {
    const eq = { inundation: 0.2, terrain: 0.2, land: 0.2, access: 0.2, demand: 0.2 }
    for (const w of [
      { ...eq, inundation: 1.2 },
      { ...eq, inundation: 0.6 },
    ]) {
      const e = caughtError(() => parseWeights(w)) as BusinessError
      expect(e).toBeInstanceOf(BusinessError)
      expect(e.status).toBe(400)
      expect(e.bizCode).toBe(400001)
    }
  })

  it('阳性对照：合法入参不抛（缺省权重 / AHP 特征向量）', () => {
    expect(() => parseSuitabilityQuery({})).not.toThrow()
    expect(() => parseWeights(defaultWeights())).not.toThrow()
  })
})

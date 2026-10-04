// @vitest-environment node
// GET /defaults 单源回归：权重 = AHP 定稿特征向量（SITE_AHP_MATRIX，2026-09-30
// 用户认可，CR=0.052）；阈值/minLandFrac/resolution 与解析缺省同源（dto DEFAULT_*），
// 非手抄。前端快照（defaults.snapshot.ts）与此对齐的守卫见前端 store 单测。
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MIN_LAND_FRAC,
  DEFAULT_RESOLUTION,
} from '../src/modules/site-suitability/dto/site-suitability.dto'
import { DEFAULT_THRESHOLDS } from '../src/modules/site-suitability/constants/score.constants'
import type { SiteSuitabilityRepository } from '../src/modules/site-suitability/repositories/site-suitability.repository'
import { SiteSuitabilityService } from '../src/modules/site-suitability/services/site-suitability.service'

const stubRepo = {} as unknown as SiteSuitabilityRepository

/** AHP 定稿特征向量全精度（幂迭代亲手复算；矩阵见 site-ahp.constants.ts） */
const FINAL_WEIGHTS: Record<string, number> = {
  inundation: 0.42993537381873326,
  terrain: 0.08451837333607896,
  land: 0.20591100060530831,
  access: 0.10971791699328601,
  demand: 0.1699173352465935,
}

describe('GET /defaults 单源', () => {
  it('权重 = AHP 定稿特征向量（键序对齐入参五键，1e-9）', () => {
    const d = new SiteSuitabilityService(stubRepo).getDefaults()
    expect(Object.keys(d.weights)).toEqual(['inundation', 'terrain', 'land', 'access', 'demand'])
    for (const [k, v] of Object.entries(FINAL_WEIGHTS)) {
      expect(d.weights[k]).toBeCloseTo(v, 9)
    }
  })

  it('阈值/minLandFrac/resolution 与解析缺省同源（非手抄）', () => {
    const d = new SiteSuitabilityService(stubRepo).getDefaults()
    expect(d.thresholds).toEqual(DEFAULT_THRESHOLDS)
    expect(d.minLandFrac).toBe(DEFAULT_MIN_LAND_FRAC)
    expect(d.resolution).toBe(DEFAULT_RESOLUTION)
    expect(d.source).toBe('SITE_AHP_MATRIX@2026-09-30')
  })
})

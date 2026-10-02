// @vitest-environment node
/**
 * 聚合分辨率入参解析（性能治本，2026-10-02）：
 * 全量 14 万格 ≈ 28.8MB 响应 ⇒ 允许按 resolution 聚合。本用例钉住三件事：
 * ① 缺省/空值 = 0（全分辨率，保持既有消费方行为不变）；
 * ② 合法值原样透传；
 * ③ 越界/非数值必须抛错（不许静默回落——否则前端以为聚合了、其实拉全量）。
 */
import { describe, expect, it } from 'vitest'

import { parseSuitabilityQuery } from '../src/modules/site-suitability/dto/site-suitability.dto'

describe('parseSuitabilityQuery · resolution', () => {
  it('缺省 = 0（全分辨率）', () => {
    expect(parseSuitabilityQuery({}).resolution).toBe(0)
  })

  it('空串同样按缺省处理（前端不传或传空都在语义内）', () => {
    expect(parseSuitabilityQuery({ resolution: '' }).resolution).toBe(0)
  })

  it('合法值原样透传', () => {
    expect(parseSuitabilityQuery({ resolution: '0.02' }).resolution).toBe(0.02)
    expect(parseSuitabilityQuery({ resolution: 0.05 }).resolution).toBe(0.05)
  })

  it('越界/非数值抛错（不静默回落成全量）', () => {
    expect(() => parseSuitabilityQuery({ resolution: '-1' })).toThrow(/resolution/)
    expect(() => parseSuitabilityQuery({ resolution: '2' })).toThrow(/resolution/)
    expect(() => parseSuitabilityQuery({ resolution: 'abc' })).toThrow(/resolution/)
  })

  it('与其余入参互不影响（权重缺省回落 AHP，min_land_frac 校验仍在）', () => {
    const q = parseSuitabilityQuery({ resolution: '0.02', min_land_frac: '0.3' })
    expect(q.resolution).toBe(0.02)
    expect(q.minLandFrac).toBe(0.3)
    expect(Object.keys(q.weights).sort()).toEqual([
      'access',
      'demand',
      'inundation',
      'land',
      'terrain',
    ])
    expect(() => parseSuitabilityQuery({ min_land_frac: '9' })).toThrow(/min_land_frac/)
  })
})

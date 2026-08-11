// @vitest-environment node
/**
 * scoringService 评分核心单测（专项8 副本 8-3）
 * 触发测试：8-1（极点纬度 cos 分母守卫，旧 ||1 兜底被浮点 cos(90°)≈6.12e-17 绕过）、
 * 8-2（RBush 无 isEmpty，旧判空防御为死代码——修复后 all() 判空行为等价、防御生效）。
 * 用例锁定分数"值"而非仅字段存在（siteAnalysisService.test.js 旧断言只查 toHaveProperty('score')）。
 */
import { describe, it, expect } from 'vitest'

import { importanceToRadius, linearDecay, scoreXiaoqu } from '../scoringService.js'

const hospitalAt = (lng, lat) => [{ lng, lat, name: '测试医院' }]

describe('scoreXiaoqu — 选址评分核心（8-3）', () => {
  const typeSettings = { hospital: { selected: true, radius: 5 } }

  it('正常输入 → 得分 > 0（分数值断言：8-2 防御复活后行为不变，评分链路可用）', () => {
    const result = scoreXiaoqu(
      [{ id: 'xq1', name: '北部湾小区', lng: 108.6, lat: 21.85 }],
      { hospital: hospitalAt(108.6, 21.85) },
      typeSettings
    )
    expect(result[0].score).toBeGreaterThan(0)
    expect(result[0].breakdown.hospital).toBeGreaterThan(0)
  })

  it('设施在 maxDistance 外 → 0 分（decay 边界）', () => {
    // 与设施纬度差 5°≈555km，远大于 radius 5km
    const result = scoreXiaoqu(
      [{ id: 'xq1', lng: 108.6, lat: 26.85 }],
      { hospital: hospitalAt(108.6, 21.85) },
      typeSettings
    )
    expect(result[0].score).toBe(0)
  })

  it('设施类型无数据 → 0 分不崩（8-2：!facilityIndex undefined 兜底分支）', () => {
    const result = scoreXiaoqu(
      [{ id: 'xq1', lng: 108.6, lat: 21.85 }],
      { hospital: [] },
      typeSettings
    )
    expect(result[0].score).toBe(0)
  })

  it('极点纬度 lat=90 → 打分正常且分数有限（8-1：cos 分母守卫）', () => {
    // 修复前 lngOffset≈7.36e14 度，粗筛全量退化；守卫后 bbox 保守扩张，无 NaN/Infinity
    const result = scoreXiaoqu(
      [{ id: 'xq1', lng: 0, lat: 90 }],
      { hospital: hospitalAt(108.6, 21.85) },
      typeSettings
    )
    expect(Number.isFinite(result[0].score)).toBe(true)
  })
})

describe('linearDecay / importanceToRadius — 评分辅助', () => {
  it('linearDecay：同点满分，边界 0 分', () => {
    expect(linearDecay(0, 5)).toBe(100)
    expect(linearDecay(5, 5)).toBe(0)
  })

  it('importanceToRadius：档位放大系数', () => {
    expect(importanceToRadius(3, 3)).toBe(3)
    expect(importanceToRadius(3, 5)).toBe(6.6) // 3 * 2.2 = 6.6
  })
})

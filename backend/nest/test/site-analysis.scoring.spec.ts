import { describe, expect, it } from 'vitest'

import type { FacilityPoint, TypeSetting } from '../src/modules/site-analysis/scoring'
import {
  DEFAULT_WEIGHTS,
  importanceToRadius,
  kmToDegreeOffset,
  linearDecay,
  scoreXiaoqu,
} from '../src/modules/site-analysis/scoring'

// 移植 Express services/__tests__/scoringService.test.js（专项8 副本 8-3），14 用例语义。
// 触发测试：8-1（极点纬度 cos 分母守卫，旧 ||1 兜底被浮点 cos(90°)≈6.12e-17 绕过）、
// 8-2（RBush 无 isEmpty，旧判空防御为死代码——修复后 all() 判空行为等价、防御生效）。
// 用例锁定分数"值"而非仅字段存在（siteAnalysisService.test.js 旧断言只查 toHaveProperty('score')）。

const hospitalAt = (lng: number, lat: number) => [{ lng, lat, name: '测试医院' }]

const typeSettings: Record<string, TypeSetting> = { hospital: { selected: true, radius: 5 } }

describe('scoreXiaoqu — 选址评分核心（8-3）', () => {
  it('正常输入 → 得分 > 0（分数值断言：8-2 防御复活后行为不变，评分链路可用）', () => {
    const result = scoreXiaoqu(
      [{ id: 'xq1', name: '北部湾小区', lng: 108.6, lat: 21.85 }],
      { hospital: hospitalAt(108.6, 21.85) },
      typeSettings
    )
    expect(result[0].score).toBeGreaterThan(0)
    expect(result[0].breakdown?.hospital).toBeGreaterThan(0)
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
    expect(Number.isFinite(result[0].score as number)).toBe(true)
  })

  // 816-专项8 发现10：NaN/坏坐标防御分支的触发测试（02 §5.6 不变量 5「NaN 禁传播」无锁定，
  // 防御分支回退无人察觉——历史实锤坏数据静默算进结果）
  it('linearDecay(NaN, 5) = 0（NaN 守卫可触发）', () => {
    expect(linearDecay(NaN, 5)).toBe(0)
  })

  it('设施含 NaN 坐标 → 被 buildFacilityIndex 跳过，结果无 NaN', () => {
    const result = scoreXiaoqu(
      [{ id: 'xq1', lng: 108.6, lat: 21.85 }],
      {
        hospital: [
          { lng: NaN, lat: 21.85, name: '坏设施' },
          { lng: 108.6, lat: 21.85, name: '好医院' },
        ],
      },
      typeSettings
    )
    expect(Number.isFinite(result[0].score as number)).toBe(true)
    expect(Number.isFinite(result[0].breakdown?.hospital as number)).toBe(true)
  })

  it('小区含 NaN 坐标 → 按 0 分处理且 breakdown 非 NaN', () => {
    const result = scoreXiaoqu(
      [{ id: 'xq1', lng: NaN, lat: 21.85 }],
      { hospital: hospitalAt(108.6, 21.85) },
      typeSettings
    )
    expect(result[0].score).toBe(0)
    expect(Number.isFinite(result[0].breakdown?.hospital as number)).toBe(true)
  })

  // 816-专项8 发现12：加权平均公式与「无设施拉低总分」语义锁定（02 §4.1 应然契约，
  // 原 9 个用例从未断言多类型合并后的 score 数值）
  it('加权平均：无设施因子 0 分且权重计入分母（固定期望值）', () => {
    const xq = [{ id: 'xq1', lng: 108.6, lat: 21.85 }]
    const facility: Record<string, FacilityPoint[]> = {
      hospital: [], // 无设施 → 0 分
      school: [{ lng: 108.6, lat: 21.85, name: '测试小学' }], // 同点 → 满分 100
    }
    const settings: Record<string, TypeSetting> = {
      hospital: { selected: true, radius: 5 },
      school: { selected: true, radius: 5 },
    }
    // 等权重：(0×1 + 100×1)/(1+1) = 50 —— 无设施因子把总分从 100 拉低到 50
    const equal = scoreXiaoqu(xq, facility, settings, { hospital: 1, school: 1 })
    expect(equal[0].score).toBe(50)
    // 权重 0 因子不贡献分子（仍计入分母，恒等）：(0×0 + 100×1)/(0+1) = 100
    const zeroWeight = scoreXiaoqu(xq, facility, settings, { hospital: 0, school: 1 })
    expect(zeroWeight[0].score).toBe(100)
  })

  it('未 selected 的设施类型不参与评分（不计入分子分母）', () => {
    const result = scoreXiaoqu(
      [{ id: 'xq1', lng: 108.6, lat: 21.85 }],
      { hospital: hospitalAt(108.6, 21.85), park: [] },
      { hospital: { selected: true, radius: 5 }, park: { selected: false, radius: 5 } }
    )
    expect(result[0].breakdown).toEqual({ hospital: 100 })
    expect(result[0].score).toBe(100)
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

  it('importanceToRadius：非表项输入回落 3 档（系数 1.0）', () => {
    expect(importanceToRadius(3, undefined)).toBe(3)
    expect(importanceToRadius(3, 99)).toBe(3)
    expect(importanceToRadius(3, 0)).toBe(3)
  })

  it('DEFAULT_WEIGHTS 六类权重与 Express 侧一致', () => {
    expect(DEFAULT_WEIGHTS).toEqual({
      hospital: 1.2,
      primary_school: 1.0,
      middle_school: 1.0,
      park: 0.8,
      bus_station: 0.6,
      mall: 0.7,
    })
  })
})

describe('kmToDegreeOffset — bbox 粗筛保守化（8-6）', () => {
  it('经度偏移不小于按中心纬度换算的旧值（高纬一侧 cos 更小 → 偏移更大）', () => {
    const { lngOffset } = kmToDegreeOffset(200, 21.85)
    const centerBased = 200 / (111 * Math.cos((21.85 * Math.PI) / 180))
    expect(lngOffset).toBeGreaterThanOrEqual(centerBased)
  })

  it('纬度偏移固定 km/111', () => {
    expect(kmToDegreeOffset(111, 21.85).latOffset).toBeCloseTo(1, 5)
  })

  it('极点纬度仍有限且保守（8-1 守卫延续）', () => {
    const { lngOffset } = kmToDegreeOffset(5, 90)
    expect(Number.isFinite(lngOffset)).toBe(true)
    expect(lngOffset).toBeGreaterThan(0)
  })
})

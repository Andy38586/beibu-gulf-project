import { describe, expect, it } from 'vitest'

import type { FacilityPoint } from '../src/modules/site-analysis/scoring'
import {
  buildTypeCoverage,
  extractValidPoi,
  filterMatchedXiaoqu,
  intersectCoverages,
  rankXiaoqu,
  resolveRadiusSettings,
  validateSelection,
} from '../src/modules/site-analysis/site-analysis.service'
import { SiteAnalysisService } from '../src/modules/site-analysis/site-analysis.service'

// 移植 Express services/__tests__/siteAnalysisService.test.js（R-14 选址流水线 + R-10 半径校验）
// 11 用例语义。Nest 侧 runSiteAnalysis 是 SiteAnalysisService 的方法（Express 为独立导出函数），
// 其余校验/清洗/覆盖/求交/筛选/排名函数仍为纯导出，可直接等价断言。

const selectedKeys = ['hospital', 'school']
const typeSettings = {
  hospital: { defaultRadius: 3, importance: 3 },
  school: { defaultRadius: 3, importance: 3 },
}
const facilityData = {
  hospital: [{ lng: 108.6, lat: 21.85, name: '港区医院' }],
  school: [{ lng: 108.6, lat: 21.85, name: '港区学校' }],
}
const xiaoquData: FacilityPoint[] = [{ lng: 108.6, lat: 21.85, name: '北部湾小区' }]

function run(input: Record<string, unknown>) {
  return new SiteAnalysisService().runSiteAnalysis(input as never)
}

describe('SiteAnalysisService.runSiteAnalysis — 选址流水线（R-14）', () => {
  it('正常输入 → 返回 error=null 且结构完整（coverage/matchedXiaoqu/facilityPoi）', () => {
    const result = run({ selectedKeys, typeSettings, facilityData, xiaoquData })
    expect(result.error).toBeNull()
    expect(result.coverage).toBeTruthy()
    expect(Array.isArray(result.matchedXiaoqu)).toBe(true)
    expect(typeof result.facilityPoi).toBe('object')
  })

  it('facilityPoi 返回各选中类型参与评分的全部合法 POI（含覆盖区外的点）', () => {
    const result = run({ selectedKeys, typeSettings, facilityData, xiaoquData })
    expect(result.facilityPoi.hospital).toHaveLength(1)
    expect(result.facilityPoi.school).toHaveLength(1)
    expect(result.facilityPoi.hospital[0]).toMatchObject({ lng: 108.6, lat: 21.85 })

    // 覆盖区外的合法 POI 同样参与评分（评分按最近设施距离衰减），必须随结果返回
    const wideData = {
      hospital: [
        { lng: 108.6, lat: 21.85, name: '近点医院' },
        { lng: 114.5, lat: 24.5, name: '远点医院' },
      ],
      school: [{ lng: 108.6, lat: 21.85, name: '港区学校' }],
    }
    const wide = run({ selectedKeys, typeSettings, facilityData: wideData, xiaoquData })
    expect(wide.facilityPoi.hospital).toHaveLength(2)
  })

  it('facilityPoi 过滤脏数据：越界/[0,0]/重复坐标不参与（与覆盖计算入参同源）', () => {
    const dirtyData = {
      hospital: [
        { lng: 108.6, lat: 21.85, name: '合法点' },
        { lng: 108.6, lat: 21.85, name: '重复坐标点' },
        { lng: 0, lat: 0, name: '原点哨兵' },
        { lng: 30, lat: 21.85, name: '越界点' },
        { name: '缺坐标点' },
      ],
      school: [{ lng: 108.6, lat: 21.85, name: '港区学校' }],
    }
    const result = run({ selectedKeys, typeSettings, facilityData: dirtyData, xiaoquData })
    expect(result.facilityPoi.hospital).toHaveLength(1)
    expect(result.facilityPoi.hospital[0].name).toBe('合法点')
  })

  it('匹配小区进入 matchedXiaoqu 排名结果', () => {
    const result = run({ selectedKeys, typeSettings, facilityData, xiaoquData })
    expect(result.matchedXiaoqu.length).toBeGreaterThanOrEqual(1)
    expect(result.matchedXiaoqu[0]).toHaveProperty('score')
  })

  it('未选设施类型 → 返回 error（validateSelection）', () => {
    const result = run({ selectedKeys: [], typeSettings: {}, facilityData, xiaoquData })
    expect(result.error).toBeTruthy()
    expect(result.matchedXiaoqu).toEqual([])
    expect(result.facilityPoi).toEqual({})
  })

  it('覆盖范围无重叠 → 返回 empty 合法空结果标记（8-1：非 error，02 §4.1）', () => {
    // 两类设施相距极远，缓冲区无交集。
    // 注意：坐标必须在北部湾范围内（经度105-115/纬度18-25，见 buildTypeCoverage 过滤），
    // 否则该类型 coverage 为 undefined 会被 intersectCoverages 静默剔除，测不到 failKey。
    const farFacilityData = {
      hospital: [{ lng: 108.6, lat: 21.85 }],
      school: [{ lng: 114.5, lat: 24.5 }],
    }
    const result = run({ selectedKeys, typeSettings, facilityData: farFacilityData, xiaoquData })
    expect(result.error).toBeNull()
    expect(result.empty).toBe(true)
    expect(result.emptyReason).toContain('无重叠区域')
  })

  it('全部类型覆盖数据不可用 → emptyReason 走 failKey=null 专属文案', () => {
    const result = run({
      selectedKeys: ['hospital'],
      typeSettings: { hospital: { selected: true, defaultRadius: 5, importance: 3 } },
      facilityData: { hospital: [] }, // 无设施 → buildTypeCoverage 返回 null → intersectCoverages 全空
      xiaoquData: [],
    })
    expect(result.empty).toBe(true)
    expect(result.emptyReason).not.toContain('null')
    expect(result.emptyReason).toContain('覆盖数据均不可用')
  })

  it('排名按 score 降序且截断至 TOP_N=10', () => {
    const many: FacilityPoint[] = Array.from({ length: 30 }, (_, i) => ({
      lng: 108.6 + i * 0.001,
      lat: 21.85,
      name: `小区${i}`,
    }))
    const result = run({ selectedKeys: ['hospital'], typeSettings, facilityData, xiaoquData: many })
    expect(result.matchedXiaoqu.length).toBeLessThanOrEqual(10)
    const scores = result.matchedXiaoqu.map((x) => x.score as number)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })
})

describe('resolveRadiusSettings — 半径校验（R-10 服务级）', () => {
  it('合法 defaultRadius → 返回 resolved radius', () => {
    const resolved = resolveRadiusSettings(['hospital'], {
      hospital: { defaultRadius: 3, importance: 3 },
    })
    expect(resolved.hospital.radius).toBe(3)
  })

  it('defaultRadius=0 → 抛 INVALID_PARAMS（半径无效）', () => {
    expect(() =>
      resolveRadiusSettings(['hospital'], { hospital: { defaultRadius: 0, importance: 3 } })
    ).toThrow(/半径/)
  })

  it('defaultRadius 为负 → 抛 INVALID_PARAMS', () => {
    expect(() =>
      resolveRadiusSettings(['hospital'], { hospital: { defaultRadius: -5, importance: 3 } })
    ).toThrow(/半径/)
  })

  it('typeSettings 缺键 → 抛 INVALID_PARAMS（防御 selectedKeys 与 typeSettings 键集不一致）', () => {
    expect(() => resolveRadiusSettings(['hospital'], {})).toThrow(/缺少 typeSettings/)
  })

  it('importance 档位放大半径（1~5 → 0.4/0.7/1.0/1.5/2.2）', () => {
    expect(resolveRadiusSettings(['h'], { h: { defaultRadius: 3, importance: 5 } }).h.radius).toBe(
      6.6
    )
    expect(resolveRadiusSettings(['h'], { h: { defaultRadius: 3, importance: 1 } }).h.radius).toBe(
      1.2
    )
  })
})

describe('选址纯函数 — 清洗/覆盖/求交/筛选', () => {
  it('validateSelection：空数组/null 返回错误文案，非空返回 null', () => {
    expect(validateSelection([])).toBe('请至少选择一种设施类型')
    expect(validateSelection(null)).toBe('请至少选择一种设施类型')
    expect(validateSelection(['hospital'])).toBeNull()
  })

  it('extractValidPoi：去重 + [0,0] 过滤 + 北部湾边界过滤', () => {
    const points = [
      { lng: 108.6, lat: 21.85, name: 'a' },
      { lng: 108.6, lat: 21.85, name: 'dup' },
      { lng: 0, lat: 0, name: 'origin' },
      { lng: 104.9, lat: 21.85, name: 'west-out' },
      { lng: 108.6, lat: 25.1, name: 'north-out' },
      { name: 'no-coord' },
    ]
    const valid = extractValidPoi(points as unknown as FacilityPoint[])
    expect(valid).toHaveLength(1)
    expect(valid[0].name).toBe('a')
  })

  it('buildTypeCoverage：无有效点返回 null；有效点返回带 geometry 的 Feature', () => {
    expect(buildTypeCoverage([], 3)).toBeNull()
    expect(buildTypeCoverage(null, 3)).toBeNull()
    const cov = buildTypeCoverage([{ lng: 108.6, lat: 21.85 }], 3)
    expect(cov).toBeTruthy()
    expect(cov?.geometry).toBeTruthy()
  })

  it('intersectCoverages：无有效覆盖 → { area:null, failKey:null }', () => {
    expect(intersectCoverages([null, undefined] as never[], ['hospital', 'school'])).toEqual({
      area: null,
      failKey: null,
    })
  })

  it('intersectCoverages：不相交 → area=null 且 failKey 指向断裂类型', () => {
    const a = buildTypeCoverage([{ lng: 108.6, lat: 21.85 }], 2)
    const b = buildTypeCoverage([{ lng: 114.5, lat: 24.5 }], 2)
    const { area, failKey } = intersectCoverages([a, b], ['hospital', 'school'])
    expect(area).toBeNull()
    expect(failKey).toBe('school')
  })

  it('filterMatchedXiaoqu：空数据返回 []；无索引时全量精筛', () => {
    expect(filterMatchedXiaoqu([], { geometry: { type: 'Polygon', coordinates: [] } })).toEqual([])
    const area = buildTypeCoverage([{ lng: 108.6, lat: 21.85 }], 3)
    const matched = filterMatchedXiaoqu(
      [
        { lng: 108.6, lat: 21.85, name: 'in' },
        { lng: 109.6, lat: 21.85, name: 'out' },
        { lng: 30, lat: 21.85, name: 'invalid-region' },
      ],
      area
    )
    expect(matched.map((m) => m.name)).toEqual(['in'])
  })

  it('rankXiaoqu：TOP_N 截断 + breakdown 各因子为有限值', () => {
    const matched = Array.from({ length: 15 }, (_, i) => ({
      lng: 108.6 + i * 0.0005,
      lat: 21.85,
      name: `xq${i}`,
    }))
    const ranked = rankXiaoqu(
      matched,
      facilityData,
      { hospital: { selected: true, radius: 3 } },
      {}
    )
    expect(ranked).toHaveLength(10)
    for (const r of ranked) {
      expect(Number.isFinite(r.score as number)).toBe(true)
      for (const [k, v] of Object.entries(r.breakdown as Record<string, number>)) {
        expect(k).toBeTruthy()
        expect(Number.isFinite(v)).toBe(true)
      }
    }
  })
})

// @vitest-environment node
/**
 * siteAnalysisService 回归测试（R-14 选址流水线 + R-10 半径校验服务级）
 * R-14：runSiteAnalysis 端到端（mock facilityData / xiaoquData）→ 断言返回结构
 * { error, coverage, matchedXiaoqu[], facilityPoi{} }，覆盖选址核心链路。
 * R-10：resolveRadiusSettings 对非法半径（0 / 负）抛 INVALID_PARAMS（服务级兜底）。
 */
import { describe, expect, it } from 'vitest'

import { resolveRadiusSettings, runSiteAnalysis } from '../siteAnalysisService.js'

describe('siteAnalysisService.runSiteAnalysis — 选址流水线（R-14）', () => {
  const selectedKeys = ['hospital', 'school']
  const typeSettings = {
    hospital: { defaultRadius: 3, importance: 3 },
    school: { defaultRadius: 3, importance: 3 },
  }
  const facilityData = {
    hospital: [{ lng: 108.6, lat: 21.85, name: '港区医院' }],
    school: [{ lng: 108.6, lat: 21.85, name: '港区学校' }],
  }
  const xiaoquData = [{ lng: 108.6, lat: 21.85, name: '北部湾小区' }]

  it('正常输入 → 返回 error=null 且结构完整（coverage/matchedXiaoqu/facilityPoi）', () => {
    const result = runSiteAnalysis({ selectedKeys, typeSettings, facilityData, xiaoquData })
    expect(result.error).toBeNull()
    expect(result.coverage).toBeTruthy()
    expect(Array.isArray(result.matchedXiaoqu)).toBe(true)
    expect(typeof result.facilityPoi).toBe('object')
  })

  it('facilityPoi 返回各选中类型参与评分的全部合法 POI（含覆盖区外的点）', () => {
    const result = runSiteAnalysis({ selectedKeys, typeSettings, facilityData, xiaoquData })
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
    const wide = runSiteAnalysis({
      selectedKeys,
      typeSettings,
      facilityData: wideData,
      xiaoquData,
    })
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
    const result = runSiteAnalysis({
      selectedKeys,
      typeSettings,
      facilityData: dirtyData,
      xiaoquData,
    })
    expect(result.facilityPoi.hospital).toHaveLength(1)
    expect(result.facilityPoi.hospital[0].name).toBe('合法点')
  })

  it('匹配小区进入 matchedXiaoqu 排名结果', () => {
    const result = runSiteAnalysis({ selectedKeys, typeSettings, facilityData, xiaoquData })
    expect(result.matchedXiaoqu.length).toBeGreaterThanOrEqual(1)
    expect(result.matchedXiaoqu[0]).toHaveProperty('score')
  })

  it('未选设施类型 → 返回 error（validateSelection）', () => {
    const result = runSiteAnalysis({ selectedKeys: [], typeSettings: {}, facilityData, xiaoquData })
    expect(result.error).toBeTruthy()
    expect(result.matchedXiaoqu).toEqual([])
    expect(result.facilityPoi).toEqual({})
  })

  it('覆盖范围无重叠 → 返回 empty 合法空结果标记（8-1：非 error，02 §4.1）', () => {
    // 两类设施相距极远，缓冲区无交集。
    // 注意：坐标必须在北部湾范围内（经度105-115/纬度18-25，见 buildTypeCoverage 314-003 过滤），
    // 否则该类型 coverage 为 undefined 会被 intersectCoverages 静默剔除，测不到 failKey。
    const farFacilityData = {
      hospital: [{ lng: 108.6, lat: 21.85 }],
      school: [{ lng: 114.5, lat: 24.5 }],
    }
    const result = runSiteAnalysis({
      selectedKeys,
      typeSettings,
      facilityData: farFacilityData,
      xiaoquData,
    })
    expect(result.error).toBeNull()
    expect(result.empty).toBe(true)
    expect(result.emptyReason).toContain('无重叠区域')
  })
})

describe('siteAnalysisService.resolveRadiusSettings — 半径校验（R-10 服务级）', () => {
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

  it('全部类型覆盖数据不可用 → emptyReason 不出现 null 字样（failKey=null 专属文案）', () => {
    const result = runSiteAnalysis({
      selectedKeys: ['hospital'],
      typeSettings: { hospital: { selected: true, defaultRadius: 5, importance: 3 } },
      facilityData: { hospital: [] }, // 无设施 → buildTypeCoverage 返回 null → intersectCoverages 全空
      xiaoquData: [],
    })
    expect(result.empty).toBe(true)
    expect(result.emptyReason).not.toContain('null')
    expect(result.emptyReason).toContain('覆盖数据均不可用')
  })
})

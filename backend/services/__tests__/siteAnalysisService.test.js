// @vitest-environment node
/**
 * siteAnalysisService 回归测试（R-14 选址流水线 + R-10 半径校验服务级）
 * R-14：runSiteAnalysis 端到端（mock facilityData / xiaoquData）→ 断言返回结构
 * { error, coverage, matchedXiaoqu[], facilityPoi{} }，覆盖选址核心链路。
 * R-10：resolveRadiusSettings 对非法半径（0 / 负）抛 INVALID_PARAMS（服务级兜底）。
 */
import { describe, expect, it } from 'vitest'

import {
  resolveRadiusSettings,
  runSiteAnalysis,
  validateSelection,
} from '../siteAnalysisService.js'

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

  it('覆盖范围内设施 POI 被正确筛选（facilityPoi 含两类且各有 1 个）', () => {
    const result = runSiteAnalysis({ selectedKeys, typeSettings, facilityData, xiaoquData })
    expect(result.facilityPoi.hospital).toHaveLength(1)
    expect(result.facilityPoi.school).toHaveLength(1)
    expect(result.facilityPoi.hospital[0]).toMatchObject({ lng: 108.6, lat: 21.85 })
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
})

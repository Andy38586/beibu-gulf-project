// @vitest-environment node
/**
 * siteAnalysisService.filterFacilitiesInCoverage 测试
 * 覆盖：空间索引版本（bbox 粗筛 + queryByPolygon）对原逐点 booleanPointInPolygon 的等价性。
 * 场景：覆盖范围内设施被保留、范围外被剔除、无效坐标被防御。
 */
import * as turf from '@turf/turf'
import { describe, expect, it } from 'vitest'

import { filterFacilitiesInCoverage } from '../siteAnalysisService.js'

/** 钦州港附近的一个小矩形覆盖区（turf Polygon Feature，与生产 finalArea 结构一致） */
function makeFinalArea() {
  const coords = [
    [
      [108.55, 21.8],
      [108.65, 21.8],
      [108.65, 21.9],
      [108.55, 21.9],
      [108.55, 21.8],
    ],
  ]
  return turf.polygon(coords)
}

describe('filterFacilitiesInCoverage（空间索引版本）', () => {
  it('覆盖范围内的设施被保留', () => {
    const finalArea = makeFinalArea()
    const facilityData = {
      hospital: [
        { lng: 108.6, lat: 21.85, name: '港区医院' },
        { lng: 108.62, lat: 21.86, name: '中心医院' },
      ],
    }
    const result = filterFacilitiesInCoverage(facilityData, finalArea, ['hospital'])
    expect(result.hospital).toHaveLength(2)
    expect(result.hospital[0].name).toBe('港区医院')
  })

  it('覆盖范围外的设施被剔除', () => {
    const finalArea = makeFinalArea()
    const facilityData = {
      park: [
        { lng: 108.6, lat: 21.85, name: '园内公园' },
        { lng: 109.2, lat: 22.5, name: '园外公园' }, // 远在范围外
      ],
    }
    const result = filterFacilitiesInCoverage(facilityData, finalArea, ['park'])
    expect(result.park).toHaveLength(1)
    expect(result.park[0].name).toBe('园内公园')
  })

  it('无效坐标（缺字段/非数值）被防御，不崩溃', () => {
    const finalArea = makeFinalArea()
    const facilityData = {
      school: [
        { lng: 108.6, lat: 21.85, name: '有效学校' },
        { lng: 'bad', lat: 21.85, name: '脏数据' },
        { name: '缺坐标' },
      ],
    }
    const result = filterFacilitiesInCoverage(facilityData, finalArea, ['school'])
    expect(result.school).toHaveLength(1)
    expect(result.school[0].name).toBe('有效学校')
  })

  it('空设施类型返回空数组', () => {
    const finalArea = makeFinalArea()
    const result = filterFacilitiesInCoverage({ hospital: [] }, finalArea, ['hospital'])
    expect(result.hospital).toEqual([])
  })

  it('与逐点 booleanPointInPolygon 结果一致（等价性回归）', () => {
    const finalArea = makeFinalArea()
    const points = [
      { lng: 108.6, lat: 21.85, name: 'p1' }, // 内
      { lng: 108.62, lat: 21.86, name: 'p2' }, // 内
      { lng: 108.4, lat: 21.6, name: 'p3' }, // 外
      { lng: 109.0, lat: 22.0, name: 'p4' }, // 外
    ]
    const facilityData = { mall: points }
    const result = filterFacilitiesInCoverage(facilityData, finalArea, ['mall'])

    const expected = points.filter((p) =>
      turf.booleanPointInPolygon(turf.point([p.lng, p.lat]), finalArea)
    )
    expect(result.mall.map((p) => p.name).sort()).toEqual(expected.map((p) => p.name).sort())
  })
})

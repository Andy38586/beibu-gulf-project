import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { FACILITY_TYPE_LABELS, getFacilityTypeLabel } from '../constants/facilityTypeLabels'

/**
 * 修复守卫：设施类型词表必须覆盖后端数据侧全部 type。
 * 权威源 = backend/data/flood/facilityPoints.json（与 schemas.test.ts 同口径跨仓读数）。
 * 阳性对照：给数据文件加一个新 type（如 '管道'）而词表未接入 ⇒ 本用例红。
 */
describe('facilityTypeLabels：词表与后端数据侧 type 对齐', () => {
  const data = JSON.parse(
    readFileSync(join(__dirname, '../../../../../backend/data/flood/facilityPoints.json'), 'utf8')
  ) as { facilities: Array<{ type: string }> }
  const dataTypes = [...new Set(data.facilities.map((f) => f.type))].sort()

  it('数据侧每个 type 都在词表里（命中 4/4）', () => {
    expect(dataTypes.length).toBeGreaterThan(0)
    const missing = dataTypes.filter((t) => !(t in FACILITY_TYPE_LABELS))
    expect(missing).toEqual([])
  })

  it('词表没有数据侧不存在的僵尸键', () => {
    const extra = Object.keys(FACILITY_TYPE_LABELS).filter((k) => !dataTypes.includes(k))
    expect(extra).toEqual([])
  })

  it('未登记类型原样回显，不伪装、不静默丢弃', () => {
    expect(getFacilityTypeLabel('港口码头')).toBe('港口码头')
    expect(getFacilityTypeLabel('某新类型')).toBe('某新类型')
    expect(getFacilityTypeLabel(undefined)).toBe('')
    expect(getFacilityTypeLabel('')).toBe('')
  })
})

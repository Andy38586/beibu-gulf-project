import { describe, expect, it } from 'vitest'

import { evaluateChecks } from '../verify.mjs'

const ROAD_SPEC = { name: 'roads', geomType: 'LINESTRING', srid: 4490, checkBBox: true }
const PROTECTED_SPEC = {
  name: 'protected_areas',
  geomType: 'MULTIPOLYGON',
  srid: 4490,
  checkBBox: false,
}

function row(overrides = {}) {
  return {
    count: '100',
    invalid_geom: '0',
    null_geom: '0',
    out_of_bounds: '0',
    typed_geom: '100',
    srid: '4490',
    ...overrides,
  }
}

describe('evaluateChecks — 质检判定（T4.1 测试要求：坏几何 fixture 触发 FAIL）', () => {
  it('健康数据全 PASS', () => {
    const { entry, checks } = evaluateChecks(ROAD_SPEC, row())
    expect(entry.fail).toEqual([])
    expect(Object.values(checks).every(Boolean)).toBe(true)
  })

  it('坏几何（ST_IsValid 检出）→ invalid_geom FAIL', () => {
    const { entry } = evaluateChecks(ROAD_SPEC, row({ invalid_geom: '3' }))
    expect(entry.fail).toContain('invalid_geom')
  })

  it('越界几何 → bbox_ok FAIL（北部湾业务边界）', () => {
    const { entry } = evaluateChecks(ROAD_SPEC, row({ out_of_bounds: '1' }))
    expect(entry.fail).toContain('bbox_ok')
  })

  it('几何类型错（Point/LineString 混入）→ geom_type_ok FAIL', () => {
    const { entry } = evaluateChecks(ROAD_SPEC, row({ typed_geom: '50' }))
    expect(entry.fail).toContain('geom_type_ok')
  })

  it('SRID 漂移（4490 → 4326）→ srid FAIL', () => {
    const { entry } = evaluateChecks(ROAD_SPEC, row({ srid: '4326' }))
    expect(entry.fail).toContain('srid')
  })

  it('空表 = 未导入 → not_imported 单 fail（非质量 FAIL）', () => {
    const { entry, empty } = evaluateChecks(ROAD_SPEC, row({ count: '0', srid: null }))
    expect(empty).toBe(true)
    expect(entry.fail).toEqual(['not_imported'])
  })

  it('protected_areas 豁免 bbox（全国保护区跨省合法）', () => {
    const { entry } = evaluateChecks(PROTECTED_SPEC, row({ out_of_bounds: '31' }))
    expect(entry.fail).not.toContain('bbox_ok')
  })
})

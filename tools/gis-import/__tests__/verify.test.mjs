import { describe, expect, it } from 'vitest'

import { evaluateChecks, parseGulfBounds } from '../verify.mjs'

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

// 边界常量由 gis.constants.ts 单一事实源解析而来：解析必须 fail fast，
// 静默回退到内联副本会让质检边界与业务边界分叉（比报错危险）。
describe('parseGulfBounds — 业务边界单一事实源解析', () => {
  const SRC = `export const GULF_BOUNDS = {
  minLng: 105,
  maxLng: 115,
  minLat: 18,
  maxLat: 25,
} as const`

  it('正常源码解析出四至边界', () => {
    expect(parseGulfBounds(SRC)).toEqual({ minLng: 105, maxLng: 115, minLat: 18, maxLat: 25 })
  })

  it('缺 GULF_BOUNDS 定义 → 抛错（不静默用内置值）', () => {
    expect(() => parseGulfBounds('export const OTHER = 1')).toThrow(/未找到 GULF_BOUNDS/)
  })

  it('缺字段 → 抛错', () => {
    expect(() => parseGulfBounds(SRC.replace('maxLng: 115,', ''))).toThrow(/缺少 maxLng/)
  })

  it('数值不自洽（minLng >= maxLng）→ 抛错', () => {
    expect(() => parseGulfBounds(SRC.replace('minLng: 105', 'minLng: 120'))).toThrow(/数值不自洽/)
  })
})

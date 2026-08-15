// @vitest-environment node
/**
 * floodService.assessDisaster 回归测试（8-7 同源修复后语义）
 * 正常行为（8-7 修复后，2026-08-14）：
 * - 受影响设施 = 与淹没多边形（floodZone.features）做点-多边形空间筛选（与 online 连通演算同口径）
 * - loss = value * damageRate；totalLoss 为各 loss 四舍五入求和
 * - floodZone 为 null / features 空 → 空结果、riskLevel '无'（02 §4.3：水位 0 = 无淹没）
 * 边界防御（B-9 保留）：
 * - 坐标缺失/非有限 → 排除（原 elevation 判空防御迁移为坐标判空）
 * - value/damageRate 缺失 → 按 0 计 loss，totalLoss 恒为有限数
 */
import { describe, it, expect } from 'vitest'

import { assessDisaster } from '../floodService.js'

/** 淹没多边形（正方形 0-1 度）：包含 (0.5,0.5)，不包含 (2,2) */
const POLY = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ],
  },
  properties: {},
}
const floodZone = { waterLevel: 5, riskLevel: '高风险', features: [POLY] }

describe('floodService.assessDisaster — 空间筛选语义（8-7 同源）', () => {
  it('多边形内的设施计入；多边形外的排除（不再仅凭 elevation）', () => {
    const facilities = [
      { id: 'f1', name: 'A', lng: 0.5, lat: 0.5, value: 100, damageRate: 0.5 },
      { id: 'f2', name: 'B', lng: 2, lat: 2, value: 200, damageRate: 0.3 },
    ]
    const r = assessDisaster(facilities, 5, floodZone)
    expect(r.affectedFacilities).toHaveLength(1)
    expect(r.affectedFacilities[0].id).toBe('f1')
  })

  it('多边形边界内的设施计入（包含语义，booleanPointInPolygon）', () => {
    const facilities = [{ id: 'f1', name: 'A', lng: 0.5, lat: 0.5, value: 100, damageRate: 0.5 }]
    const r = assessDisaster(facilities, 5, floodZone)
    expect(r.affectedFacilities).toHaveLength(1)
  })

  it('loss = value * damageRate；totalLoss 为求和取整', () => {
    const facilities = [
      { id: 'f1', name: 'A', lng: 0.5, lat: 0.5, value: 100, damageRate: 0.5 },
      { id: 'f2', name: 'B', lng: 0.2, lat: 0.8, value: 200, damageRate: 0.3 },
    ]
    const r = assessDisaster(facilities, 5, floodZone)
    expect(r.affectedFacilities[0].loss).toBeCloseTo(50)
    expect(r.affectedFacilities[1].loss).toBeCloseTo(60)
    expect(r.totalLoss).toBe(110)
  })

  it('floodZone 为 null → 空结果、riskLevel 无、waterLevel undefined', () => {
    const r = assessDisaster([{ id: 'f1', lng: 0.5, lat: 0.5, value: 100, damageRate: 0.5 }], 5, null)
    expect(r.affectedFacilities).toEqual([])
    expect(r.totalLoss).toBe(0)
    expect(r.riskLevel).toBe('无')
    expect(r.waterLevel).toBeUndefined()
  })

  it('floodZone.features 为空（0 档）→ 空结果（02 §4.3：水位 0 = 无淹没）', () => {
    const r = assessDisaster(
      [{ id: 'f1', lng: 0.5, lat: 0.5, value: 100, damageRate: 0.5 }],
      0,
      { waterLevel: 0, riskLevel: '无风险', features: [] }
    )
    expect(r.affectedFacilities).toEqual([])
  })
})

describe('floodService.assessDisaster — 脏数据防御（B-9/8-4 守护）', () => {
  it('坐标缺失/非有限 → 排除（原 elevation 判空防御迁移为坐标判空）', () => {
    const r = assessDisaster(
      [
        { id: 'f1', name: 'A', value: 100, damageRate: 0.5 },
        { id: 'f2', name: 'B', lng: 0.5, lat: 0.5, value: 200, damageRate: 0.3 },
      ],
      5,
      floodZone
    )
    expect(r.affectedFacilities).toHaveLength(1)
    expect(r.affectedFacilities[0].id).toBe('f2')
  })

  it('value 缺失应计 loss=0、totalLoss 有限', () => {
    const r = assessDisaster(
      [{ id: 'f1', name: 'A', lng: 0.5, lat: 0.5, value: undefined, damageRate: 0.5 }],
      5,
      floodZone
    )
    expect(Number.isFinite(r.totalLoss)).toBe(true)
    expect(r.totalLoss).toBe(0)
  })

  it('damageRate 缺失应计 loss=0（不产出 NaN）', () => {
    const r = assessDisaster([{ id: 'f1', name: 'A', lng: 0.5, lat: 0.5, value: 100 }], 5, floodZone)
    expect(Number.isFinite(r.totalLoss)).toBe(true)
    expect(r.totalLoss).toBe(0)
  })
})

// @vitest-environment node
/**
 * floodService.assessDisaster 回归测试（R-16 洪涝灾害评估边界）
 * 正常行为（已正确实现，作为回归护栏）：
 * - elevation <= level 的设施计入受影响；elevation > level 排除
 * - loss = value * damageRate；totalLoss 为各 loss 四舍五入求和
 * - floodZone 为 null → 返回空结果、riskLevel '无'
 * 边界防御（B-9 已修复，2026-08-02 二次复审转正）：
 * - elevation=null/undefined/非有限 → 排除（原 `null <= level` 被 JS 隐式转 0 假阳性）
 * - value/damageRate 缺失 → 按 0 计 loss，totalLoss 恒为有限数（原 value*damageRate=NaN）
 * 上述两条原以 it.fails() 登记（阶段6 新发现），修复后移除 .fails() 转为守护护栏。
 */
import { describe, it, expect } from 'vitest'

import { assessDisaster } from '../floodService.js'

const floodZone = { waterLevel: 5, riskLevel: '高风险' }

describe('floodService.assessDisaster — 正常边界（R-16 护栏）', () => {
  it('elevation <= level 计入；> level 排除', () => {
    const facilities = [
      { id: 'f1', name: 'A', elevation: 2, value: 100, damageRate: 0.5 },
      { id: 'f2', name: 'B', elevation: 10, value: 200, damageRate: 0.3 },
    ]
    const r = assessDisaster(facilities, 5, floodZone)
    expect(r.affectedFacilities).toHaveLength(1)
    expect(r.affectedFacilities[0].id).toBe('f1')
  })

  it('elevation === level 计入（<= 边界）', () => {
    const facilities = [{ id: 'f1', name: 'A', elevation: 5, value: 100, damageRate: 0.5 }]
    const r = assessDisaster(facilities, 5, floodZone)
    expect(r.affectedFacilities).toHaveLength(1)
  })

  it('loss = value * damageRate；totalLoss 为求和取整', () => {
    const facilities = [
      { id: 'f1', name: 'A', elevation: 2, value: 100, damageRate: 0.5 },
      { id: 'f2', name: 'B', elevation: 1, value: 200, damageRate: 0.3 },
    ]
    const r = assessDisaster(facilities, 5, floodZone)
    expect(r.affectedFacilities[0].loss).toBeCloseTo(50)
    expect(r.affectedFacilities[1].loss).toBeCloseTo(60)
    expect(r.totalLoss).toBe(110)
  })

  it('floodZone 为 null → 空结果、riskLevel 无、waterLevel undefined', () => {
    const r = assessDisaster([{ id: 'f1', elevation: 1, value: 100, damageRate: 0.5 }], 5, null)
    expect(r.affectedFacilities).toEqual([])
    expect(r.totalLoss).toBe(0)
    expect(r.riskLevel).toBe('无')
    expect(r.waterLevel).toBeUndefined()
  })
})

describe('floodService.assessDisaster — 脏数据防御（B-9 修复后守护）', () => {
  it('B-9：elevation=null 应排除（不隐式判 0 假阳性）', () => {
    const r = assessDisaster(
      [{ id: 'f1', name: 'A', elevation: null, value: 100, damageRate: 0.5 }],
      5,
      floodZone
    )
    expect(r.affectedFacilities).toHaveLength(0)
  })

  it('B-9：elevation=undefined 应排除', () => {
    const r = assessDisaster([{ id: 'f1', name: 'A', value: 100, damageRate: 0.5 }], 5, floodZone)
    expect(r.affectedFacilities).toHaveLength(0)
  })

  it('B-9：value 缺失应计 loss=0、totalLoss 有限', () => {
    const r = assessDisaster(
      [{ id: 'f1', name: 'A', elevation: 2, value: undefined, damageRate: 0.5 }],
      5,
      floodZone
    )
    expect(Number.isFinite(r.totalLoss)).toBe(true)
    expect(r.totalLoss).toBe(0)
  })

  it('B-9：damageRate 缺失应计 loss=0（不产出 NaN）', () => {
    const r = assessDisaster([{ id: 'f1', name: 'A', elevation: 2, value: 100 }], 5, floodZone)
    expect(Number.isFinite(r.totalLoss)).toBe(true)
    expect(r.totalLoss).toBe(0)
  })
})

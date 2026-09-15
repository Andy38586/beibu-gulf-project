/**
 * 「应然契约」不变量测试（阶段 4 样板 —— 照这个形状写就行）
 *
 * 真值来源（**不是从实现反推**）：
 *   · docs/根基文档/核心流程与数据流.md §4.1「评分语义（应然契约，审查比对基准）」
 *   · docs/根基文档/核心流程与数据流.md §4.2「预测数值自洽（应然契约，审查比对基准）」
 *
 * 写法要点（三条铁律）：
 *   1. 期望值必须能指到一份契约/口径的来源（注释里写明出处章节）；
 *   2. 断言要能区分「对」与「错」——禁止 toBeDefined / toBeTruthy 这类凑数断言；
 *   3. 先让它能失败（把实现改坏 → 必须变红），再让它进 CI。
 */
import { describe, expect, it } from 'vitest'

import { IMPORTANCE_FACTOR } from '../src/common/constants/scoring.constants'
import { interpolateMonthly } from '../src/modules/forecast/services/model-loader'
import { importanceToRadius, linearDecay } from '../src/modules/site-analysis/services/scoring'

describe('§4.1 评分语义 · 距离衰减（契约原文：距离≥半径→0，否则 (1-距离/半径)×100）', () => {
  it('距离 0 → 满分 100；距离 = 半径 → 0；半程 → 50', () => {
    expect(linearDecay(0, 1000)).toBe(100)
    expect(linearDecay(1000, 1000)).toBe(0)
    expect(linearDecay(500, 1000)).toBe(50)
  })

  it('距离超出半径 → 0（不得出现负分）', () => {
    expect(linearDecay(1500, 1000)).toBe(0)
  })

  it('无效坐标（NaN 距离）→ 0 分，且 NaN 不得传播', () => {
    const got = linearDecay(Number.NaN, 1000)
    expect(got).toBe(0)
    expect(Number.isNaN(got)).toBe(false)
  })
})

describe('§4.1 评分语义 · 半径放大系数（契约原文：1:0.4 / 2:0.7 / 3:1.0 / 4:1.5 / 5:2.2）', () => {
  it('系数表与契约逐值一致', () => {
    expect(IMPORTANCE_FACTOR).toEqual({ 1: 0.4, 2: 0.7, 3: 1.0, 4: 1.5, 5: 2.2 })
  })

  it('importanceToRadius = defaultRadius × 系数（保留 1 位小数）', () => {
    expect(importanceToRadius(1000, 3)).toBe(1000)
    expect(importanceToRadius(1000, 5)).toBe(2200)
    expect(importanceToRadius(1000, 1)).toBe(400)
  })

  it('越界/非数值 importance 夹取到档位 3（不得静默返回 0 半径）', () => {
    expect(importanceToRadius(1000, 9)).toBe(1000)
    expect(importanceToRadius(1000, Number.NaN)).toBe(1000)
  })
})

describe('§4.2 预测数值自洽 · 月度插值（契约原文：半年节点间线性插值，与历史重叠月份丢弃）', () => {
  const POINTS = [
    { time: '2027-06', value: 100 },
    { time: '2027-12', value: 130 },
  ]

  it('端点取原值，中间 5 个月线性插值并取整', () => {
    const out = interpolateMonthly(POINTS, '2027-01')
    expect(out.map((p) => p.time)).toEqual([
      '2027-06',
      '2027-07',
      '2027-08',
      '2027-09',
      '2027-10',
      '2027-11',
      '2027-12',
    ])
    expect(out.map((p) => p.value)).toEqual([100, 105, 110, 115, 120, 125, 130])
  })

  it('丢弃 ≤ afterTime 的重叠点（与历史重合的月份不得重复下发）', () => {
    const out = interpolateMonthly(POINTS, '2027-06')
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({ time: '2027-12', value: 130, type: 'forecast', reliability: 1 })
  })

  it('确定性：同一输入必须同一输出（契约：禁止 Math.random 参与业务数值）', () => {
    expect(interpolateMonthly(POINTS, '2027-01')).toEqual(interpolateMonthly(POINTS, '2027-01'))
  })

  it('插值点必须落在两端点之间（单调、不越界）', () => {
    const values = interpolateMonthly(POINTS, '2027-01').map((p) => p.value)
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(100)
      expect(v).toBeLessThanOrEqual(130)
    }
  })
})

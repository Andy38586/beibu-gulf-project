import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  authResponseSchema,
  floodAreasResponseSchema,
  floodDisasterResponseSchema,
  floodOnlineResponseSchema,
  floodStatisticsResponseSchema,
  forecastIndicatorIndexSchema,
  forecastMapDataSchema,
  indicatorComparisonResponseSchema,
  planSchema,
  terrainProfileSchema,
  timeSeriesResponseSchema,
  waterAreaSchema,
} from '../schemas'

/**
 * schemas 运行时校验测试：用真实数据 + 构造样本双向验证——
 * 真实数据必须通过（否则线上断链）、畸形数据必须被拒绝。
 */
const DATA_DIR = join(__dirname, '../../../../backend/data')

// plans.json 是运行时用户数据（不入库），CI 环境不存在时跳过该用例
const plansPath = join(DATA_DIR, 'plans.json')
const plansExist = existsSync(plansPath)

describe('planSchema（真实 plans.json 全量校验）', () => {
  it.skipIf(!plansExist)('存量 18 条 plan 记录全部通过（含无 savedXiaoqu 的旧记录）', () => {
    const plans = JSON.parse(readFileSync(plansPath, 'utf8'))
    expect(Array.isArray(plans)).toBe(true)
    for (const plan of plans) {
      const result = planSchema.safeParse(plan)
      expect(
        result.success,
        `plan ${plan.id} 校验失败: ${JSON.stringify(result.error?.issues)}`
      ).toBe(true)
    }
  })

  it('缺 id 的畸形对象被拒绝', () => {
    const result = planSchema.safeParse({ name: 'no-id' })
    expect(result.success).toBe(false)
  })
})

describe('terrainProfileSchema（真实 terrainProfile.json 校验）', () => {
  it('真实 profiles 数组全部通过', () => {
    const data = JSON.parse(readFileSync(join(DATA_DIR, 'flood/terrainProfile.json'), 'utf8'))
    const result = terrainProfileSchema.safeParse(data.profiles)
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
  })

  it('缺 points 的畸形 profile 被拒绝', () => {
    const result = terrainProfileSchema.safeParse([{ id: 'x', name: 'y', points: 'bad' }])
    expect(result.success).toBe(false)
  })
})

describe('waterAreaSchema（真实 water-area.json 校验）', () => {
  it('真实 coordinates 全部通过', () => {
    const data = JSON.parse(readFileSync(join(DATA_DIR, 'flood/water-area.json'), 'utf8'))
    const result = waterAreaSchema.safeParse(data.coordinates)
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
  })

  it('畸形坐标被拒绝', () => {
    const result = waterAreaSchema.safeParse([
      [108, 21],
      ['bad', 21],
    ])
    expect(result.success).toBe(false)
  })
})

describe('authResponseSchema', () => {
  it('login/me 响应通过（token 可选）', () => {
    const withToken = authResponseSchema.safeParse({
      user: { id: '1', username: 'u', createdAt: '2026-01-01' },
      token: 'abc',
    })
    const withoutToken = authResponseSchema.safeParse({
      user: { id: '1', username: 'u', createdAt: '2026-01-01' },
    })
    expect(withToken.success).toBe(true)
    expect(withoutToken.success).toBe(true)
  })

  it('缺 user 被拒绝', () => {
    const result = authResponseSchema.safeParse({ token: 'abc' })
    expect(result.success).toBe(false)
  })
})

describe('forecast schemas（构造样本）', () => {
  const point = { time: '2018-01', value: 100, type: 'historical' as const }

  it('timeSeriesResponseSchema 通过/拒绝', () => {
    const ok = timeSeriesResponseSchema.safeParse({
      indicator: 'cargo',
      unit: '万吨',
      granularity: 'monthly',
      series: [{ portId: 'qinzhou', portName: '钦州', data: [point] }],
    })
    const bad = timeSeriesResponseSchema.safeParse({ indicator: 'cargo' })
    expect(ok.success).toBe(true)
    expect(bad.success).toBe(false)
  })

  it('indicatorComparisonResponseSchema 通过/拒绝', () => {
    const ok = indicatorComparisonResponseSchema.safeParse({
      indicator: 'cargo',
      unit: '万吨',
      ports: { qinzhou: { portName: '钦州', value: 100, historical: [point], forecast: [] } },
    })
    expect(ok.success).toBe(true)
    expect(
      indicatorComparisonResponseSchema.safeParse({ indicator: 'cargo', ports: {} }).success
    ).toBe(false)
  })

  it('forecastMapDataSchema 通过/拒绝（GeoJSON 结构）', () => {
    const ok = forecastMapDataSchema.safeParse({
      indicator: 'cargo',
      unit: '万吨',
      time: '2026-06',
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [108, 21] },
          properties: { portId: 'qinzhou', portName: '钦州', value: 100 },
        },
      ],
    })
    expect(ok.success).toBe(true)
    expect(
      forecastMapDataSchema.safeParse({ type: 'FeatureCollection', features: [] }).success
    ).toBe(false)
  })

  it('forecastIndicatorIndexSchema 通过/拒绝', () => {
    const ok = forecastIndicatorIndexSchema.safeParse({
      metadata: {
        version: '1',
        lastUpdated: '2026-01-01',
        ports: [{ id: 'qinzhou', name: '钦州', lat: 21, lng: 108 }],
        indicators: ['cargo'],
      },
      historical: { start: '2018-01', end: '2025-12' },
      forecast: { start: '2026-01', end: '2035-12' },
    })
    expect(ok.success).toBe(true)
    expect(forecastIndicatorIndexSchema.safeParse({}).success).toBe(false)
  })
})

describe('flood schemas（真实数据 + 构造样本）', () => {
  it('floodStatisticsResponseSchema 用真实 floodStatistics.json 元素通过', () => {
    const data = JSON.parse(readFileSync(join(DATA_DIR, 'flood/floodStatistics.json'), 'utf8'))
    const result = floodStatisticsResponseSchema.safeParse(data.statistics[0])
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
  })

  it('floodAreasResponseSchema 通过/拒绝', () => {
    const ok = floodAreasResponseSchema.safeParse({
      waterLevel: 2.5,
      riskLevel: '中风险',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [108, 21],
                [109, 21],
                [109, 22],
                [108, 21],
              ],
            ],
          },
          properties: { riskLevel: '中风险' },
        },
      ],
    })
    const bad = floodAreasResponseSchema.safeParse({ features: [] }) // 缺 waterLevel/riskLevel
    // D1：元素级深校验——geometry 缺失/坐标畸形均拒绝（原 z.array(z.unknown()) 放行）
    const badGeom = floodAreasResponseSchema.safeParse({
      waterLevel: 2.5,
      riskLevel: '中风险',
      features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: 'oops' } }],
    })
    expect(ok.success).toBe(true)
    expect(bad.success).toBe(false)
    expect(badGeom.success).toBe(false)
  })

  it('floodDisasterResponseSchema 通过/拒绝', () => {
    const ok = floodDisasterResponseSchema.safeParse({
      waterLevel: 2.5,
      riskLevel: '中',
      affectedFacilities: [
        {
          id: 'f1',
          name: '油库',
          type: 'oil',
          lng: 108.5,
          lat: 21.5,
          loss: 100,
          damageRate: 0.9,
        },
      ],
      totalLoss: 100,
    })
    const bad = floodDisasterResponseSchema.safeParse({ riskLevel: '中' }) // 缺 totalLoss
    // D1：元素级深校验——缺 loss 的畸形设施拒绝
    const badFac = floodDisasterResponseSchema.safeParse({
      waterLevel: 2.5,
      riskLevel: '中',
      affectedFacilities: [{ id: 'f1', name: '油库' }],
      totalLoss: 100,
    })
    expect(ok.success).toBe(true)
    expect(bad.success).toBe(false)
    expect(badFac.success).toBe(false)
  })

  it('floodOnlineResponseSchema 通过/拒绝（统一入口后仍校验）', () => {
    const ok = floodOnlineResponseSchema.safeParse({
      level: 2.5,
      featureCount: 10,
      floodedKm2: 5.2,
      features: [],
    })
    const bad = floodOnlineResponseSchema.safeParse({ level: 2.5 }) // 缺 floodedKm2
    expect(ok.success).toBe(true)
    expect(bad.success).toBe(false)
  })
})

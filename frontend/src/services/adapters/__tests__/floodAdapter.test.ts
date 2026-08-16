import { beforeEach, describe, expect, it, vi } from 'vitest'

import { floodAdapter } from '../floodAdapter'

/**
 * floodAdapter 单测（2026-08-08 数据搬后端后重写）
 * static 模式与前端静态 JSON 已删除，仅测 api（Express）与 online（FastAPI）两模式。
 * vitest 无服务器，用 vi.stubGlobal 接管 global.fetch，按 URL 返回与后端响应同构的内联数据。
 */

// 内联 fixture（结构与后端 sendSuccess 信封 / FastAPI 裸 JSON 同构）
const fixtures: Record<string, unknown> = {
  // online 模式：FastAPI /flood-online 返回裸 JSON（无信封），envelope:false 直传
  // online 模式：FastAPI /flood-online 返回裸 JSON（无信封），envelope:false 直传
  '/flood-online/api/flood/online': {
    level: 5,
    featureCount: 1,
    floodedKm2: 12.5,
    // 与 flood_engine.py 同构：properties 仅 {area}，无 riskLevel（由 adapter 校验后注入）
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [108.6, 21.8],
              [108.7, 21.8],
              [108.7, 21.9],
              [108.6, 21.8],
            ],
          ],
        },
        properties: { area: 12.5 },
      },
    ],
  },
  '/flood-online/api/flood/impact': {
    level: 15,
    affectedFacilities: [
      {
        id: 'FCG-M-001',
        name: '防城港渔澫港区1号泊位',
        type: '泊位',
        lng: 108.345,
        lat: 21.7,
        port: '防城港',
        loss: 17000,
        damageRate: 0.85,
      },
    ],
    totalLoss: 17000,
  },
}

// api 模式：Express 后端端点（sendSuccess 信封 { code, data }）
const API_BASE = (import.meta.env.VITE_API_BASE as string) || '/api'
fixtures[`${API_BASE}/flood/water-area`] = {
  code: 200,
  data: [
    [108.615, 21.855],
    [108.62, 21.855],
    [108.622, 21.858],
  ],
}
fixtures[`${API_BASE}/flood/flood-areas`] = {
  code: 200,
  data: {
    waterLevel: 5,
    actualWaterLevel: 5,
    riskLevel: '中风险',
    // 后端已按类型契约注入 riskLevel 到 feature.properties（geometry 为合法 Polygon）
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [108.6, 21.8],
              [108.7, 21.8],
              [108.7, 21.9],
              [108.6, 21.8],
            ],
          ],
        },
        properties: {
          port: '沿海区域',
          areaName: '沿海区域5m淹没区_1',
          waterLevel: 5,
          riskLevel: '中风险',
        },
      },
    ],
  },
}
fixtures[`${API_BASE}/flood/flood-statistics`] = {
  code: 200,
  data: {
    waterLevel: 5,
    riskLevel: '中风险',
    floodArea: 1.2,
    averageDepth: 0.8,
    maxDepth: 1.5,
    affectedFacilities: 3,
  },
}
fixtures[`${API_BASE}/flood/analysis/disaster`] = {
  code: 200,
  data: {
    waterLevel: 5,
    riskLevel: '中风险',
    // 后端 assessDisaster 返回 lng/lat/loss/damageRate 全字段，前端直接透传
    affectedFacilities: [
      {
        id: 'QZ-001',
        name: '铁山港油库',
        type: '油库',
        port: '钦州港',
        lng: 108.6,
        lat: 21.8,
        loss: 120.5,
        damageRate: 0.5,
      },
    ],
    totalLoss: 120.5,
  },
}

function createFetchStatic() {
  return vi.fn(async (url: string) => {
    // apiRequest 会把 params 拼成 query string——按 ? 截断匹配 fixture key
    const body = fixtures[url.split('?')[0]]
    if (body === undefined) {
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' }
    }
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }
  })
}

describe('floodAdapter', () => {
  beforeEach(() => {
    floodAdapter.setDataSource('api')
    floodAdapter.clearCache()
    vi.stubGlobal('fetch', createFetchStatic())
  })

  describe('api 模式（Express 后端）', () => {
    it('getWaterArea 应走后端 /flood/water-area 端点返回坐标数组（D-4=A）', async () => {
      const coords = await floodAdapter.getWaterArea()
      expect(Array.isArray(coords)).toBe(true)
      expect(coords.length).toBeGreaterThan(0)
      expect(coords[0]).toHaveLength(2)
    })

    it('getFloodAnalysis 应返回淹没分析结果（features 含后端注入的 riskLevel）', async () => {
      const result = await floodAdapter.getFloodAnalysis(5)
      expect(result).toHaveProperty('features')
      expect(result).toHaveProperty('statistics')
      expect(result.riskLevel).toBe('中风险')
      expect(Array.isArray(result.features)).toBe(true)
      expect(result.features[0].properties.riskLevel).toBe('中风险')
    })

    it('getImpactAssessment 应返回影响评估结果（lng/lat/loss 透传）', async () => {
      const result = await floodAdapter.getImpactAssessment(5)
      expect(result).toHaveProperty('affectedFacilities')
      expect(result.totalLoss).toBe(120.5)
      expect(Array.isArray(result.affectedFacilities)).toBe(true)
      expect(result.affectedFacilities[0].lng).toBe(108.6)
      expect(result.affectedFacilities[0].loss).toBe(120.5)
    })
  })

  describe('online 模式（flood-service FastAPI）', () => {
    it('getFloodAnalysis 应调 /flood-online/api/flood/online 并注入 riskLevel（FastAPI 无该字段，回归 0816-06）', async () => {
      floodAdapter.setDataSource('online')
      const result = await floodAdapter.getFloodAnalysis(5)
      expect(result.features).toHaveLength(1)
      // level 5 → 中风险（_riskLevelFromFlood 阈值表：≤5 中 / ≤8 高）
      expect(result.features[0].properties.riskLevel).toBe('中风险')
      expect(result.statistics.floodArea).toBe(12.5)
      expect(result.actualWaterLevel).toBe(5)
    })

    it('getImpactAssessment 应调 /flood-online/api/flood/impact 并透传裸 JSON（d073 补齐影响评估）', async () => {
      floodAdapter.setDataSource('online')
      const result = await floodAdapter.getImpactAssessment(15)
      expect(result.affectedFacilities).toHaveLength(1)
      expect(result.affectedFacilities[0].id).toBe('FCG-M-001')
      expect(result.affectedFacilities[0].loss).toBe(17000)
      expect(result.totalLoss).toBe(17000)
    })
  })
})

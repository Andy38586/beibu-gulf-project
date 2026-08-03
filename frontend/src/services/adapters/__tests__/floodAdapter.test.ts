import { beforeEach, describe, expect, it, vi } from 'vitest'

import { floodAdapter } from '../floodAdapter'

/**
 * floodAdapter 单测
 *
 * 与 forecastAdapter 同理：Adapter 内部 fetch('/data/*.json')，vitest 无服务器，
 * 故用 vi.stubGlobal 接管 global.fetch，按 URL 返回与真实 fixture 同构的内联数据。
 * getWaterArea 在 fetch 失败时会回退到兜底坐标，本测试覆盖正常返回路径。
 */

// 内联 fixture（结构与 public/data/*.json 同构）
const fixtures: Record<string, unknown> = {
  '/data/water-area.json': {
    id: 'main-water-area',
    name: '钦州港附近海域',
    coordinates: [
      [108.615, 21.855],
      [108.62, 21.855],
      [108.622, 21.858],
    ],
  },
  '/data/flood-areas.json': {
    code: 200,
    data: {
      features: [{ type: 'Feature', properties: { riskLevel: '低风险' } }],
      riskLevel: '低风险',
      actualWaterLevel: 2.5,
    },
  },
  '/data/flood-statistics.json': {
    code: 200,
    data: {
      waterLevel: 2.5,
      riskLevel: '低风险',
      floodArea: 0.85,
      averageDepth: 0.6,
    },
  },
  '/data/disaster.json': {
    code: 200,
    data: {
      affectedFacilities: [{ name: '铁山港油库', impact: '重度' }],
      totalLoss: 120.5,
    },
  },
}

function createFetchMock() {
  return vi.fn(async (url: string) => {
    const body = fixtures[url]
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

// api 模式 getWaterArea 走后端 /flood/water-area 端点（D-4=A），返回信封式 { code, data }
const API_BASE = (import.meta.env.VITE_API_BASE as string) || '/api'
fixtures[`${API_BASE}/flood/water-area`] = {
  code: 200,
  data: [
    [108.615, 21.855],
    [108.62, 21.855],
    [108.622, 21.858],
  ],
}

describe('floodAdapter', () => {
  beforeEach(() => {
    floodAdapter.setDataSource('mock')
    floodAdapter.clearCache()
    vi.stubGlobal('fetch', createFetchMock())
  })

  describe('getWaterArea', () => {
    it('应返回坐标数组', async () => {
      const coords = await floodAdapter.getWaterArea()
      expect(Array.isArray(coords)).toBe(true)
      expect(coords.length).toBeGreaterThan(0)
      expect(coords[0]).toHaveLength(2)
    })
  })

  describe('getFloodAnalysis', () => {
    it('应返回淹没分析结果', async () => {
      const result = await floodAdapter.getFloodAnalysis(5)
      expect(result).toHaveProperty('features')
      expect(result).toHaveProperty('statistics')
      expect(result).toHaveProperty('riskLevel')
      expect(Array.isArray(result.features)).toBe(true)
    })
  })

  describe('getImpactAssessment', () => {
    it('应返回影响评估结果', async () => {
      const result = await floodAdapter.getImpactAssessment(5)
      expect(result).toHaveProperty('affectedFacilities')
      expect(result).toHaveProperty('totalLoss')
      expect(Array.isArray(result.affectedFacilities)).toBe(true)
    })
  })

  describe('api 模式', () => {
    it('getWaterArea 应走后端 /flood/water-area 端点返回坐标数组（D-4=A）', async () => {
      floodAdapter.setDataSource('api')
      const coords = await floodAdapter.getWaterArea()
      expect(Array.isArray(coords)).toBe(true)
      expect(coords.length).toBeGreaterThan(0)
    })
  })
})

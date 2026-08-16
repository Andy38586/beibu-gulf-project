import { beforeEach, describe, expect, it, vi } from 'vitest'

import { forecastAdapter } from '../forecastAdapter'

/**
 * forecastAdapter 单测（816-专项5并 4-5：原 0% 覆盖 → 三端点 + 参数透传 + 信封解包全锁定）。
 * vitest 无服务器：stub global.fetch 按 URL 返回与后端 sendSuccess 信封同构的内联数据。
 * 断言重点：
 *  - 请求路径 / params 透传正确（querystring 由 apiRequest 拼装，按 ? 截断匹配）
 *  - 信封 { code, data } 解包（unwrapEnvelope 在 useApiRequest 内完成）
 *  - 返回业务形状（getTimeSeries 只透传 series、getIndicatorComparison 只透传 ports）
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string) || '/api'

// 与后端 sendSuccess 信封同构的 fixture
const fixtures: Record<string, unknown> = {
  [`${API_BASE}/forecast/overview`]: {
    code: 200,
    data: {
      metadata: {
        version: '1',
        lastUpdated: '2026-08-16',
        ports: [{ id: 'QZ', name: '钦州港', lat: 21.7, lng: 108.6 }],
        indicators: ['cargo'],
      },
      historical: { start: '2018', end: '2025' },
      forecast: { start: '2026', end: '2035' },
      charts: {
        indicator: 'cargo',
        unit: '万吨',
        granularity: 'year',
        labels: ['2024', '2025'],
        series: [{ name: 'cargo', data: [100, 110, 120] }],
      },
    },
  },
  [`${API_BASE}/forecast/timeseries`]: {
    code: 200,
    data: {
      indicator: 'cargo',
      unit: '万吨',
      granularity: 'year',
      series: [
        {
          portId: 'QZ',
          portName: '钦州港',
          data: [
            { time: '2024', value: 100, type: 'historical' },
            { time: '2025', value: 120, type: 'forecast', confidence: 0.9 },
          ],
        },
      ],
    },
  },
  [`${API_BASE}/forecast/indicator/cargo`]: {
    code: 200,
    data: {
      indicator: 'cargo',
      unit: '万吨',
      ports: {
        QZ: {
          portName: '钦州港',
          value: 100,
          historical: [{ time: '2024', value: 95, type: 'historical' }],
          forecast: [{ time: '2025', value: 100, type: 'forecast' }],
        },
        BH: {
          portName: '北海港',
          value: 80,
          historical: [{ time: '2024', value: 75, type: 'historical' }],
          forecast: [{ time: '2025', value: 80, type: 'forecast' }],
        },
      },
    },
  },
}

function createFetchStatic() {
  return vi.fn(async (url: string) => {
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

describe('forecastAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', createFetchStatic())
  })

  it('getOverview 应请求 /forecast/overview 并解包信封返回指标索引', async () => {
    const result = await forecastAdapter.getOverview()
    expect(result.metadata.indicators).toEqual(['cargo'])
    expect(result.metadata.ports).toHaveLength(1)
    expect(result.charts?.indicator).toBe('cargo')
  })

  it('getTimeSeries 应透传 indicator/granularity/confidence 参数并只返回 series', async () => {
    const fetchMock = vi.mocked(fetch)
    const result = await forecastAdapter.getTimeSeries({
      indicator: 'cargo',
      granularity: 'year',
      confidence: 0.9,
    })

    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).toContain('/forecast/timeseries')
    expect(calledUrl).toContain('indicator=cargo')
    expect(calledUrl).toContain('granularity=year')
    expect(calledUrl).toContain('confidence=0.9')
    // 业务形状收口：不透传 indicator/granularity/confidence 原字段，只透传 series
    expect(result).toEqual({
      series: [
        {
          portId: 'QZ',
          portName: '钦州港',
          data: [
            { time: '2024', value: 100, type: 'historical' },
            { time: '2025', value: 120, type: 'forecast', confidence: 0.9 },
          ],
        },
      ],
    })
  })

  it('getIndicatorComparison 应请求 /forecast/indicator/:indicator 并只返回 ports', async () => {
    const result = await forecastAdapter.getIndicatorComparison('cargo', {
      time: '2025-12',
      confidence: 0.9,
    })
    expect(result).toEqual({
      ports: {
        QZ: {
          portName: '钦州港',
          value: 100,
          historical: [{ time: '2024', value: 95, type: 'historical' }],
          forecast: [{ time: '2025', value: 100, type: 'forecast' }],
        },
        BH: {
          portName: '北海港',
          value: 80,
          historical: [{ time: '2024', value: 75, type: 'historical' }],
          forecast: [{ time: '2025', value: 80, type: 'forecast' }],
        },
      },
    })
  })

  it('未知端点应抛错（fetch 404 冒泡，不吞）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' }))
    )
    await expect(
      forecastAdapter.getTimeSeries({ indicator: 'x', granularity: 'year', confidence: 0.5 })
    ).rejects.toThrow()
  })
})

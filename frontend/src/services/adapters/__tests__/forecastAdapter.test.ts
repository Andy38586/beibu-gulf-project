import { beforeEach, describe, expect, it, vi } from 'vitest'

import { forecastAdapter } from '../forecastAdapter'

/**
 * forecastAdapter 单测（原 0% 覆盖 → 三端点 + 参数透传 + 信封解包全锁定）。
 * vitest 无服务器：stub global.fetch 按 URL 返回与后端 sendSuccess 信封同构的内联数据。
 * 断言重点：
 *  - 请求路径 / params 透传正确（querystring 由 apiRequest 拼装，按 ? 截断匹配）
 *  - 信封 { code, data } 解包（unwrapEnvelope 在 useApiRequest 内完成）
 *  - 返回业务形状（getTimeSeries 只透传 series、getIndicatorComparison 只透传 ports）
 * 前缀（/api vs /nest-api）由 useApiRequest 的 per-module 路由决定并在其单测覆盖；
 *       本测试聚焦路径/参数/解包，故 mock 先将 URL 剥掉后端前缀再按无前缀路径匹配 fixture。
 */

// 与后端 sendSuccess 信封同构的 fixture（key 为无前缀路径）
const fixtures: Record<string, unknown> = {
  '/forecast/overview': {
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
  '/forecast/timeseries': {
    code: 200,
    data: {
      indicator: 'cargo',
      unit: '万吨',
      granularity: 'year',
      canalScenario: 'baseline',
      // P1-1：模型路径标记（响应顶层 metadata，可选）
      metadata: { dataSource: 'model' },
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
  '/forecast/indicator/cargo': {
    code: 200,
    data: {
      indicator: 'cargo',
      unit: '万吨',
      canalScenario: 'baseline',
      // 降级响应：模型产物不可用时的标记
      metadata: { dataSource: 'engine-fallback' },
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

/** 剥掉后端前缀（/api 或 /nest-api），按无前缀路径匹配 fixture */
function stripBackendPrefix(url: string): string {
  return url.split('?')[0].replace(/^\/(api|nest-api)(?=\/)/, '')
}

function createFetchStatic() {
  return vi.fn(async (url: string) => {
    const body = fixtures[stripBackendPrefix(url)]
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

  it('getTimeSeries 应透传参数并返回 series + unit + dataSource（P1-1 降级标记）', async () => {
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
    // 业务形状收口：不透传 indicator/granularity 原字段，只透传 series + unit + dataSource
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
      unit: '万吨',
      dataSource: 'model',
    })
  })

  it('getIndicatorComparison 应请求 /forecast/indicator/:indicator 并返回 ports + unit + dataSource', async () => {
    const result = await forecastAdapter.getIndicatorComparison('cargo', {
      time: '2025-12',
      confidence: 0.9,
    })
    expect(result.dataSource).toBe('engine-fallback')
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
      unit: '万吨',
      dataSource: 'engine-fallback',
    })
  })

  it('旧响应无 metadata → dataSource 为 undefined（向后兼容，不误判为降级）', async () => {
    // 旧后端响应：顶层无 metadata（apiRequest 按 text() 解析，故 text/json 须同源）
    const legacy = {
      code: 200,
      data: {
        indicator: 'cargo',
        unit: '万吨',
        granularity: 'year',
        canalScenario: 'baseline',
        series: [],
      },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => legacy,
        text: async () => JSON.stringify(legacy),
      }))
    )
    const result = await forecastAdapter.getTimeSeries({
      indicator: 'cargo',
      granularity: 'year',
      confidence: 0.9,
    })
    expect(result.dataSource).toBeUndefined()
  })

  it('scenario 缺省不携带参数；提供时透传（运河情景 F4）', async () => {
    const fetchMock = vi.mocked(fetch)
    await forecastAdapter.getTimeSeries({
      indicator: 'cargo',
      granularity: 'year',
      confidence: 0.9,
    })
    let calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).not.toContain('scenario=')

    await forecastAdapter.getTimeSeries({
      indicator: 'cargo',
      granularity: 'year',
      confidence: 0.9,
      scenario: 'design',
    })
    calledUrl = fetchMock.mock.calls[1][0] as string
    expect(calledUrl).toContain('scenario=design')

    await forecastAdapter.getIndicatorComparison('cargo', {
      time: '2025-12',
      confidence: 0.9,
      scenario: 'median',
    })
    expect(String(fetchMock.mock.calls[2][0])).toContain('scenario=median')
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

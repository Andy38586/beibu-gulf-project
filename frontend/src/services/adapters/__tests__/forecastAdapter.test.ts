import { beforeEach, describe, expect, it, vi } from 'vitest'

import { forecastAdapter } from '../forecastAdapter'

/**
 * forecastAdapter 单测
 *
 * 注意：Adapter 内部通过 fetch('/data/forecast/*.json') 拉取 mock 数据。
 * vitest 环境无静态服务器、且 Node fetch 不支持相对 URL，因此用 vi.stubGlobal
 * 接管 global.fetch，按 URL 返回与真实 fixture 同构的内联数据。
 *
 * ⚠️ 与实施计划 08 文档的偏差：
 *   文档断言 getAvailableIndicators() 返回对象含顶层 `indicators` 字段，
 *   但真实 index.json 的 indicators 嵌套在 `metadata.indicators` 下（见 public/data/forecast/index.json）。
 *   这里按真实结构断言，避免测试误判。
 */

// 内联 fixture（结构与 public/data/forecast/*.json 同构，不依赖大文件）
const fixtures: Record<string, unknown> = {
  throughput: {
    indicator: 'throughput',
    unit: '万吨',
    data: { qinzhou: {}, beihai: {}, fangchenggang: {} },
  },
  berth: {
    indicator: 'berth',
    unit: '个',
    data: { qinzhou: {}, beihai: {}, fangchenggang: {} },
  },
  index: {
    metadata: {
      version: '1.0',
      indicators: ['throughput', 'berth', 'traffic', 'pressure', 'development'],
    },
    historical: { start: '2018-01', end: '2025-12' },
    forecast: { start: '2026-01', end: '2035-12' },
  },
}

function createFetchMock() {
  return vi.fn(async (url: string) => {
    const match = url.match(/\/data\/forecast\/(.+)\.json$/)
    const key = match ? match[1] : null
    const body = key ? fixtures[key] : undefined
    if (body === undefined) {
      return { ok: false, status: 404, json: async () => ({}) }
    }
    return { ok: true, status: 200, json: async () => body }
  })
}

describe('forecastAdapter', () => {
  beforeEach(() => {
    forecastAdapter.setDataSource('mock')
    vi.stubGlobal('fetch', createFetchMock())
  })

  describe('setDataSource', () => {
    it('应正确切换到 mock 模式', () => {
      forecastAdapter.setDataSource('mock')
      expect(forecastAdapter.dataSource).toBe('mock')
    })

    it('应拒绝无效模式', () => {
      expect(() => forecastAdapter.setDataSource('invalid' as never)).toThrow()
    })
  })

  describe('getIndicatorData', () => {
    it('应返回 ForecastSeries 类型数据', async () => {
      const data = (await forecastAdapter.getIndicatorData('throughput')) as unknown as Record<
        string,
        unknown
      >
      expect(data).toBeDefined()
      expect(data.indicator).toBe('throughput')
      expect(data.unit).toBeDefined()
      expect(data.data).toBeDefined()
    })

    it('mock 模式下应返回有效数据结构', async () => {
      const data = await forecastAdapter.getIndicatorData('berth')
      expect(data).toHaveProperty('indicator')
      expect(data).toHaveProperty('unit')
      expect(data).toHaveProperty('data')
    })
  })

  describe('getAvailableIndicators', () => {
    it('应返回指标索引（真实结构：metadata.indicators）', async () => {
      const index = (await forecastAdapter.getAvailableIndicators()) as Record<string, any>
      expect(index).toHaveProperty('metadata')
      expect(Array.isArray(index.metadata.indicators)).toBe(true)
      expect(index.metadata.indicators.length).toBeGreaterThan(0)
    })
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'

// 使用 vi.hoisted 保证 mock 引用能在被提升的 vi.mock 工厂中使用
const { mockReadFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
}))

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    readFile: mockReadFile,
    default: { ...actual, readFile: mockReadFile },
  }
})

// 构造一份完整的港口指标数据（24 个月历史 + 空间要素）
function makePortData(portId, portName, months = 24, baseValue = 1000) {
  const historical = []
  for (let i = 0; i < months; i++) {
    const year = 2020 + Math.floor(i / 12)
    const month = (i % 12) + 1
    historical.push({
      time: `${year}-${String(month).padStart(2, '0')}`,
      value: baseValue + i * 10,
      type: 'historical',
    })
  }
  return {
    historical,
    spatial: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [108.4, 22.9] },
          properties: { portId, portName },
        },
      ],
    },
  }
}

const throughputData = {
  indicator: 'throughput',
  unit: 'TEU',
  data: {
    p1: makePortData('p1', '港口A'),
    p2: makePortData('p2', '港口B'),
  },
}

function makeEnoentError() {
  return Object.assign(new Error('not found'), { code: 'ENOENT' })
}

describe('forecastService', () => {
  let forecastService

  beforeEach(async () => {
    mockReadFile.mockReset()
    // 重置模块缓存以清空 forecastService 内部的 engineCache
    vi.resetModules()
    forecastService = await import('../forecastService.js')
  })

  describe('getMapData', () => {
    it('正常加载并格式化为 FeatureCollection', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(throughputData))
      const result = await forecastService.getMapData('throughput', '2020-01')
      expect(result.type).toBe('FeatureCollection')
      expect(result.indicator).toBe('throughput')
      expect(result.unit).toBe('TEU')
      expect(result.time).toBe('2020-01')
      expect(result.features.length).toBeGreaterThan(0)
      // 2 个港口 × 40 个散射点
      expect(result.features).toHaveLength(80)
    })

    it('feature.properties 仅暴露 portId/portName/value/reliability', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(throughputData))
      const result = await forecastService.getMapData('throughput', '2020-01')
      const props = result.features[0].properties
      expect(Object.keys(props).sort()).toEqual(
        ['portId', 'portName', 'reliability', 'value'].sort()
      )
    })

    it('数据文件缺失时优雅降级，返回空 FeatureCollection', async () => {
      mockReadFile.mockRejectedValue(makeEnoentError())
      const result = await forecastService.getMapData('throughput', '2020-01')
      expect(result.indicator).toBe('throughput')
      expect(result.unit).toBe('')
      expect(result.features).toEqual([])
      expect(result.type).toBe('FeatureCollection')
    })

    it('非 ENOENT 错误应向上抛出', async () => {
      const err = Object.assign(new Error('permission denied'), { code: 'EACCES' })
      mockReadFile.mockRejectedValue(err)
      await expect(forecastService.getMapData('throughput', '2020-01')).rejects.toThrow()
    })

    it('空间数据缺失时跳过该港口', async () => {
      const data = {
        indicator: 'throughput',
        unit: 'TEU',
        data: {
          p1: { historical: throughputData.data.p1.historical, spatial: null },
          p2: throughputData.data.p2,
        },
      }
      mockReadFile.mockResolvedValue(JSON.stringify(data))
      const result = await forecastService.getMapData('throughput', '2020-01')
      // 仅 p2 贡献 40 个 feature
      expect(result.features).toHaveLength(40)
      for (const f of result.features) {
        expect(f.properties.portId).toBe('p2')
      }
    })

    it('相同指标与情景级别时复用引擎缓存', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(throughputData))
      await forecastService.getMapData('throughput', '2020-01', 1.0)
      await forecastService.getMapData('throughput', '2020-06', 1.0)
      expect(mockReadFile).toHaveBeenCalledTimes(1)
    })

    it('不同情景级别不命中缓存', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(throughputData))
      await forecastService.getMapData('throughput', '2020-01', 1.0)
      await forecastService.getMapData('throughput', '2020-01', 1.2)
      expect(mockReadFile).toHaveBeenCalledTimes(2)
    })
  })

  describe('getPortData', () => {
    it('指定单一指标加载该港口数据', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(throughputData))
      const result = await forecastService.getPortData('p1', 'throughput')
      expect(result.portId).toBe('p1')
      expect(result.portName).toBe('港口A')
      expect(result.indicators.throughput.unit).toBe('TEU')
      expect(result.indicators.throughput.historical.length).toBeGreaterThan(0)
      expect(result.indicators.throughput.forecast.length).toBeGreaterThan(0)
    })

    it('未指定指标时加载默认 4 个指标', async () => {
      mockReadFile.mockImplementation((path) => {
        if (path.endsWith('throughput.json')) {
          return Promise.resolve(JSON.stringify(throughputData))
        }
        if (path.endsWith('berth.json')) {
          return Promise.resolve(
            JSON.stringify({ indicator: 'berth', unit: '个', data: { p1: makePortData('p1', '港口A') } })
          )
        }
        if (path.endsWith('traffic.json')) {
          return Promise.resolve(
            JSON.stringify({ indicator: 'traffic', unit: '辆', data: { p1: makePortData('p1', '港口A') } })
          )
        }
        if (path.endsWith('pressure.json')) {
          return Promise.resolve(
            JSON.stringify({ indicator: 'pressure', unit: '指数', data: { p1: makePortData('p1', '港口A') } })
          )
        }
        return Promise.reject(makeEnoentError())
      })
      const result = await forecastService.getPortData('p1')
      expect(Object.keys(result.indicators).sort()).toEqual(
        ['berth', 'pressure', 'throughput', 'traffic'].sort()
      )
    })

    it('端口不存在时返回空 indicators', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(throughputData))
      const result = await forecastService.getPortData('nonexistent', 'throughput')
      expect(result.portName).toBe('')
      expect(result.indicators).toEqual({})
    })

    it('所有指标文件缺失时优雅降级', async () => {
      mockReadFile.mockRejectedValue(makeEnoentError())
      const result = await forecastService.getPortData('p1')
      expect(result.portName).toBe('')
      expect(result.indicators).toEqual({})
    })

    it('start/end 参数同时过滤历史与预测数据', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(throughputData))
      const result = await forecastService.getPortData('p1', 'throughput', '2020-06', '2025-06')
      const hist = result.indicators.throughput.historical
      const fc = result.indicators.throughput.forecast
      expect(hist.length).toBeGreaterThan(0)
      expect(fc.length).toBeGreaterThan(0)
      for (const d of hist) {
        expect(d.time >= '2020-06').toBe(true)
        expect(d.time <= '2025-06').toBe(true)
      }
      for (const d of fc) {
        expect(d.time >= '2020-06').toBe(true)
        expect(d.time <= '2025-06').toBe(true)
      }
    })
  })

  describe('getIndicatorData', () => {
    it('不指定 portId 时返回全部港口', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(throughputData))
      const result = await forecastService.getIndicatorData('throughput', '2020-01')
      expect(Object.keys(result.ports).sort()).toEqual(['p1', 'p2'])
      expect(result.ports.p1.portName).toBe('港口A')
      expect(result.ports.p2.portName).toBe('港口B')
    })

    it('指定 portId 时仅返回该港口', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(throughputData))
      const result = await forecastService.getIndicatorData('throughput', '2020-01', 'p1')
      expect(Object.keys(result.ports)).toEqual(['p1'])
    })

    it('提供时间参数匹配历史值', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(throughputData))
      const result = await forecastService.getIndicatorData('throughput', '2020-01', 'p1')
      // makePortData 中 2020-01 的值为 baseValue = 1000
      expect(result.ports.p1.value).toBe(1000)
    })

    it('提供时间参数匹配预测值', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(throughputData))
      // 2022-01 为第一条预测
      const result = await forecastService.getIndicatorData('throughput', '2022-01', 'p1')
      expect(result.ports.p1.value).toBeGreaterThan(0)
    })

    it('时间不匹配时 value 为 null', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(throughputData))
      const result = await forecastService.getIndicatorData('throughput', '1999-01', 'p1')
      expect(result.ports.p1.value).toBeNull()
    })

    it('不提供时间参数时 value 为 null', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(throughputData))
      const result = await forecastService.getIndicatorData('throughput', undefined, 'p1')
      expect(result.ports.p1.value).toBeNull()
    })

    it('数据文件缺失时返回空 ports（优雅降级）', async () => {
      mockReadFile.mockRejectedValue(makeEnoentError())
      const result = await forecastService.getIndicatorData('throughput', '2020-01')
      expect(result.indicator).toBe('throughput')
      expect(result.unit).toBe('')
      expect(result.ports).toEqual({})
    })
  })

  describe('getTimeSeriesData', () => {
    it('拼接历史与预测时间序列', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(throughputData))
      const result = await forecastService.getTimeSeriesData('throughput', 'p1')
      expect(result.series).toHaveLength(1)
      const series = result.series[0]
      // 24 历史 + 120 预测 = 144
      expect(series.data).toHaveLength(144)
      expect(series.data[0].time).toBe('2020-01')
      expect(series.portName).toBe('港口A')
    })

    it('start/end 过滤时间序列', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(throughputData))
      const result = await forecastService.getTimeSeriesData(
        'throughput',
        'p1',
        '2020-06',
        '2021-06'
      )
      for (const d of result.series[0].data) {
        expect(d.time >= '2020-06').toBe(true)
        expect(d.time <= '2021-06').toBe(true)
      }
    })

    it('year 粒度按年聚合为 YYYY 时间格式', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(throughputData))
      const result = await forecastService.getTimeSeriesData(
        'throughput',
        'p1',
        undefined,
        undefined,
        'year'
      )
      const series = result.series[0]
      expect(series.data.length).toBeGreaterThan(0)
      for (const d of series.data) {
        expect(d.time).toMatch(/^\d{4}$/)
      }
      // 历史覆盖 2020-2021，预测覆盖 2022-2031
      const years = series.data.map((d) => d.time)
      expect(years).toContain('2020')
      expect(years).toContain('2021')
      expect(years).toContain('2022')
    })

    it('year 粒度 value 为年均值（整数）', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(throughputData))
      const result = await forecastService.getTimeSeriesData(
        'throughput',
        'p1',
        undefined,
        undefined,
        'year'
      )
      for (const d of result.series[0].data) {
        expect(Number.isInteger(d.value)).toBe(true)
      }
    })

    it('默认 granularity 为 month', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(throughputData))
      const result = await forecastService.getTimeSeriesData('throughput', 'p1')
      expect(result.granularity).toBe('month')
    })

    it('不指定 portId 时返回所有港口序列', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(throughputData))
      const result = await forecastService.getTimeSeriesData('throughput')
      expect(result.series).toHaveLength(2)
      const portIds = result.series.map((s) => s.portId).sort()
      expect(portIds).toEqual(['p1', 'p2'])
    })
  })
})

// forecastService 回归测试（R-11 缓存失效 / R-15 年聚合）
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

const cargoData = {
  indicator: 'cargo',
  unit: '万吨',
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
      mockReadFile.mockResolvedValue(JSON.stringify(cargoData))
      const result = await forecastService.getMapData('cargo', '2020-01')
      expect(result.type).toBe('FeatureCollection')
      expect(result.indicator).toBe('cargo')
      expect(result.unit).toBe('万吨')
      expect(result.time).toBe('2020-01')
      expect(result.features.length).toBeGreaterThan(0)
      // 2 个港口 × 40 个散射点
      expect(result.features).toHaveLength(80)
    })

    it('feature.properties 仅暴露 portId/portName/value/reliability', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(cargoData))
      const result = await forecastService.getMapData('cargo', '2020-01')
      const props = result.features[0].properties
      expect(Object.keys(props).sort()).toEqual(
        ['portId', 'portName', 'reliability', 'value'].sort()
      )
    })

    it('数据文件缺失时抛 NOT_FOUND（不再优雅降级返空）', async () => {
      mockReadFile.mockRejectedValue(makeEnoentError())
      await expect(forecastService.getMapData('cargo', '2020-01')).rejects.toThrow(
        '指标数据文件不存在'
      )
    })

    it('非 ENOENT 错误应向上抛出', async () => {
      const err = Object.assign(new Error('permission denied'), { code: 'EACCES' })
      mockReadFile.mockRejectedValue(err)
      await expect(forecastService.getMapData('cargo', '2020-01')).rejects.toThrow()
    })

    it('空间数据缺失时跳过该港口', async () => {
      const data = {
        indicator: 'cargo',
        unit: 'TEU',
        data: {
          p1: { historical: cargoData.data.p1.historical, spatial: null },
          p2: cargoData.data.p2,
        },
      }
      mockReadFile.mockResolvedValue(JSON.stringify(data))
      const result = await forecastService.getMapData('cargo', '2020-01')
      // 仅 p2 贡献 40 个 feature
      expect(result.features).toHaveLength(40)
      for (const f of result.features) {
        expect(f.properties.portId).toBe('p2')
      }
    })

    it('相同指标与情景级别时复用引擎缓存', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(cargoData))
      await forecastService.getMapData('cargo', '2020-01', 1.0)
      await forecastService.getMapData('cargo', '2020-06', 1.0)
      expect(mockReadFile).toHaveBeenCalledTimes(1)
    })

    it('不同情景级别不命中引擎缓存（文件级缓存命中，仅读一次文件）', async () => {
      // 2026-08-08：readDataFile 收敛到 readStaticJson（文件级 TTL/LRU 缓存）——
      // 同指标文件两次调用只读一次（文件缓存命中）；引擎缓存按 (indicator, scenarioLevel)
      // 独立 key，1.0/1.2 不互相命中（各自重新计算），但数据读取复用缓存。
      mockReadFile.mockResolvedValue(JSON.stringify(cargoData))
      await forecastService.getMapData('cargo', '2020-01', 1.0)
      await forecastService.getMapData('cargo', '2020-01', 1.2)
      expect(mockReadFile).toHaveBeenCalledTimes(1)
    })
  })

  describe('getPortData', () => {
    it('指定单一指标加载该港口数据', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(cargoData))
      const result = await forecastService.getPortData('p1', 'cargo')
      expect(result.portId).toBe('p1')
      expect(result.portName).toBe('港口A')
      expect(result.indicators.cargo.unit).toBe('万吨')
      expect(result.indicators.cargo.historical.length).toBeGreaterThan(0)
      expect(result.indicators.cargo.forecast.length).toBeGreaterThan(0)
    })

    it('未指定指标时加载默认 2 个真实指标（cargo/container）', async () => {
      mockReadFile.mockImplementation((path) => {
        if (path.endsWith('cargo.json')) {
          return Promise.resolve(JSON.stringify(cargoData))
        }
        if (path.endsWith('container.json')) {
          return Promise.resolve(
            JSON.stringify({ indicator: 'container', unit: 'TEU', data: { p1: makePortData('p1', '港口A') } })
          )
        }
        return Promise.reject(makeEnoentError())
      })
      const result = await forecastService.getPortData('p1')
      expect(Object.keys(result.indicators).sort()).toEqual(['cargo', 'container'])
    })

    it('端口不存在时返回空 indicators', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(cargoData))
      const result = await forecastService.getPortData('nonexistent', 'cargo')
      expect(result.portName).toBe('')
      expect(result.indicators).toEqual({})
    })

    it('所有指标文件缺失时抛 NOT_FOUND', async () => {
      mockReadFile.mockRejectedValue(makeEnoentError())
      await expect(forecastService.getPortData('p1')).rejects.toThrow('指标数据文件不存在')
    })

    it('start/end 参数同时过滤历史与预测数据', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(cargoData))
      const result = await forecastService.getPortData('p1', 'cargo', '2020-06', '2025-06')
      const hist = result.indicators.cargo.historical
      const fc = result.indicators.cargo.forecast
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
      mockReadFile.mockResolvedValue(JSON.stringify(cargoData))
      const result = await forecastService.getIndicatorData('cargo', '2020-01')
      expect(Object.keys(result.ports).sort()).toEqual(['p1', 'p2'])
      expect(result.ports.p1.portName).toBe('港口A')
      expect(result.ports.p2.portName).toBe('港口B')
    })

    it('指定 portId 时仅返回该港口', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(cargoData))
      const result = await forecastService.getIndicatorData('cargo', '2020-01', 'p1')
      expect(Object.keys(result.ports)).toEqual(['p1'])
    })

    it('提供时间参数匹配历史值', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(cargoData))
      const result = await forecastService.getIndicatorData('cargo', '2020-01', 'p1')
      // makePortData 中 2020-01 的值为 baseValue = 1000
      expect(result.ports.p1.value).toBe(1000)
    })

    it('提供时间参数匹配预测值', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(cargoData))
      // 2022-01 为第一条预测
      const result = await forecastService.getIndicatorData('cargo', '2022-01', 'p1')
      expect(result.ports.p1.value).toBeGreaterThan(0)
    })

    it('时间不匹配时 value 为 null', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(cargoData))
      const result = await forecastService.getIndicatorData('cargo', '1999-01', 'p1')
      expect(result.ports.p1.value).toBeNull()
    })

    it('不提供时间参数时 value 为 null', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(cargoData))
      const result = await forecastService.getIndicatorData('cargo', undefined, 'p1')
      expect(result.ports.p1.value).toBeNull()
    })

    it('数据文件缺失时抛 NOT_FOUND（不再优雅降级）', async () => {
      mockReadFile.mockRejectedValue(makeEnoentError())
      await expect(
        forecastService.getIndicatorData('cargo', '2020-01')
      ).rejects.toThrow('指标数据文件不存在')
    })
  })

  describe('getTimeSeriesData', () => {
    it('拼接历史与预测时间序列', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(cargoData))
      const result = await forecastService.getTimeSeriesData('cargo', 'p1')
      expect(result.series).toHaveLength(1)
      const series = result.series[0]
      // 24 历史 + 120 预测 = 144
      expect(series.data).toHaveLength(144)
      expect(series.data[0].time).toBe('2020-01')
      expect(series.portName).toBe('港口A')
    })

    it('start/end 过滤时间序列', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(cargoData))
      const result = await forecastService.getTimeSeriesData(
        'cargo',
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
      mockReadFile.mockResolvedValue(JSON.stringify(cargoData))
      const result = await forecastService.getTimeSeriesData(
        'cargo',
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
      mockReadFile.mockResolvedValue(JSON.stringify(cargoData))
      const result = await forecastService.getTimeSeriesData(
        'cargo',
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
      mockReadFile.mockResolvedValue(JSON.stringify(cargoData))
      const result = await forecastService.getTimeSeriesData('cargo', 'p1')
      expect(result.granularity).toBe('month')
    })

    it('不指定 portId 时返回所有港口序列', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(cargoData))
      const result = await forecastService.getTimeSeriesData('cargo')
      expect(result.series).toHaveLength(2)
      const portIds = result.series.map((s) => s.portId).sort()
      expect(portIds).toEqual(['p1', 'p2'])
    })
  })

  describe('getMapData - 缓存 TTL 失效 (REQ-2)', () => {
    it('TTL 内（同指标同情景）复用缓存，不重读盘', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(cargoData))
      await forecastService.getMapData('cargo', '2020-01', 1.0)
      await forecastService.getMapData('cargo', '2020-06', 1.0)
      expect(mockReadFile).toHaveBeenCalledTimes(1)
    })

    it('TTL 过期（>5min）后重新读盘并刷新缓存', async () => {
      const nowSpy = vi.spyOn(Date, 'now')
      let t = 1_700_000_000_000
      nowSpy.mockImplementation(() => t)
      try {
        mockReadFile.mockResolvedValue(JSON.stringify(cargoData))
        await forecastService.getMapData('cargo', '2020-01', 1.0)
        expect(mockReadFile).toHaveBeenCalledTimes(1)

        // 篡改源数据（首港历史首点）
        const updated = JSON.parse(JSON.stringify(cargoData))
        updated.data.p1.historical[0].value = 999999
        mockReadFile.mockResolvedValue(JSON.stringify(updated))

        // 前进 6 分钟，超过 CACHE_TTL_MS(5min)
        t += 6 * 60 * 1000
        const second = await forecastService.getMapData('cargo', '2020-01', 1.0)
        expect(mockReadFile).toHaveBeenCalledTimes(2)
        // 重算后特征数量不变（2 港 × 40 点）
        expect(second.features).toHaveLength(80)
      } finally {
        nowSpy.mockRestore()
      }
    })
  })
})

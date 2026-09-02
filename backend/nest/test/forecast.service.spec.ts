import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BusinessError } from '../src/common/errors/business-error'
import { DEFAULT_READ_FILE } from '../src/infra/files/data-files.service'
import { DataFilesService } from '../src/infra/files/data-files.service'
import { ForecastService } from '../src/modules/forecast/services/forecast.service'

// forecastService 单测：mock reader（对齐 Express vi.mock fs/promises 模式），
// 覆盖缓存复用（R-11）/ ENOENT→404（R-7）/ 年聚合（R-15）/ 缓存命中=重算不变量（02 §5.6.4）
function makePortData(portId: string, portName: string, months = 24, baseValue = 1000) {
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

const berthData = {
  indicator: 'berth',
  unit: '个',
  data: {
    p1: {
      historical: makePortData('p1', '港口A').historical,
      forecast: [{ time: '2022-01', value: 42, type: 'forecast', reliability: 1 }],
    },
  },
}

function makeEnoentError() {
  return Object.assign(new Error('not found'), { code: 'ENOENT' })
}

function makeService(mockReadFile: ReturnType<typeof vi.fn>): ForecastService {
  const files = new DataFilesService(mockReadFile as unknown as typeof DEFAULT_READ_FILE)
  return new ForecastService(files)
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('getMapData', () => {
  it('正常加载并格式化为 FeatureCollection（2 港 × 40 散射点）', async () => {
    const mockReadFile = vi.fn().mockResolvedValue(JSON.stringify(cargoData))
    const service = makeService(mockReadFile)
    const result = (await service.getMapData('cargo', '2020-01')) as Record<string, unknown>
    expect(result.type).toBe('FeatureCollection')
    expect(result.indicator).toBe('cargo')
    expect(result.unit).toBe('万吨')
    expect(result.time).toBe('2020-01')
    expect(result.features).toHaveLength(80)
  })

  it('feature.properties 仅暴露 portId/portName/value/reliability', async () => {
    const mockReadFile = vi.fn().mockResolvedValue(JSON.stringify(cargoData))
    const service = makeService(mockReadFile)
    const result = (await service.getMapData('cargo', '2020-01')) as {
      features: Array<{ properties: Record<string, unknown> }>
    }
    expect(Object.keys(result.features[0].properties).sort()).toEqual(
      ['portId', 'portName', 'reliability', 'value'].sort()
    )
  })

  it('数据文件缺失 → 404 NOT_FOUND（不再优雅降级返空）', async () => {
    const mockReadFile = vi.fn().mockRejectedValue(makeEnoentError())
    const service = makeService(mockReadFile)
    await expect(service.getMapData('cargo', '2020-01')).rejects.toThrow('指标数据文件不存在')
    await expect(service.getMapData('cargo', '2020-01')).rejects.toBeInstanceOf(BusinessError)
  })

  it('非 ENOENT 错误向上抛出', async () => {
    const err = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    const mockReadFile = vi.fn().mockRejectedValue(err)
    const service = makeService(mockReadFile)
    await expect(service.getMapData('cargo', '2020-01')).rejects.toThrow('permission denied')
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
    const mockReadFile = vi.fn().mockResolvedValue(JSON.stringify(data))
    const service = makeService(mockReadFile)
    const result = (await service.getMapData('cargo', '2020-01')) as {
      features: Array<{ properties: { portId: string } }>
    }
    expect(result.features).toHaveLength(40)
    for (const f of result.features) {
      expect(f.properties.portId).toBe('p2')
    }
  })

  it('相同指标复用引擎缓存（cargo 链路 2 次读盘：指标文件 + 模型产物）', async () => {
    const mockReadFile = vi.fn().mockResolvedValue(JSON.stringify(cargoData))
    const service = makeService(mockReadFile)
    await service.getMapData('cargo', '2020-01', 1.0)
    await service.getMapData('cargo', '2020-06', 1.0)
    expect(mockReadFile).toHaveBeenCalledTimes(2)
  })

  it('不同情景级别不命中引擎缓存（文件级缓存生效仍 2 次读盘）', async () => {
    const mockReadFile = vi.fn().mockResolvedValue(JSON.stringify(cargoData))
    const service = makeService(mockReadFile)
    await service.getMapData('cargo', '2020-01', 1.0)
    await service.getMapData('cargo', '2020-01', 1.2)
    expect(mockReadFile).toHaveBeenCalledTimes(2)
  })

  it('缓存命中=重算不变量（02 §5.6.4）：热缓存结果与冷实例结果深等', async () => {
    const mockReadFile = vi.fn().mockResolvedValue(JSON.stringify(berthData))
    const warm = makeService(mockReadFile)
    const cold = makeService(mockReadFile)
    const first = await warm.getMapData('berth', '2022-01')
    const second = await warm.getMapData('berth', '2022-01') // 引擎缓存命中
    const fresh = await cold.getMapData('berth', '2022-01') // 全新实例（无缓存）
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(JSON.stringify(fresh)).toBe(JSON.stringify(first))
  })
})

describe('getPortData', () => {
  it('指定单一指标加载该港口数据', async () => {
    const mockReadFile = vi.fn().mockResolvedValue(JSON.stringify(cargoData))
    const service = makeService(mockReadFile)
    const result = (await service.getPortData('p1', 'cargo')) as Record<string, any>
    expect(result.portId).toBe('p1')
    expect(result.portName).toBe('港口A')
    expect(result.indicators.cargo.unit).toBe('万吨')
    expect(result.indicators.cargo.historical.length).toBeGreaterThan(0)
  })

  it('未指定指标默认加载 cargo/container', async () => {
    const mockReadFile = vi.fn().mockImplementation((p: string) => {
      if (p.endsWith('cargo.json')) return Promise.resolve(JSON.stringify(cargoData))
      if (p.endsWith('container.json')) {
        return Promise.resolve(
          JSON.stringify({
            indicator: 'container',
            unit: 'TEU',
            data: { p1: makePortData('p1', '港口A') },
          })
        )
      }
      return Promise.reject(makeEnoentError())
    })
    const service = makeService(mockReadFile)
    const result = (await service.getPortData('p1')) as { indicators: Record<string, unknown> }
    expect(Object.keys(result.indicators).sort()).toEqual(['cargo', 'container'])
  })

  it('端口不存在返回空 indicators', async () => {
    const mockReadFile = vi.fn().mockResolvedValue(JSON.stringify(cargoData))
    const service = makeService(mockReadFile)
    const result = (await service.getPortData('nonexistent', 'cargo')) as Record<string, unknown>
    expect(result.portName).toBe('')
    expect(result.indicators).toEqual({})
  })

  it('start/end 同时过滤历史与预测', async () => {
    const mockReadFile = vi.fn().mockResolvedValue(JSON.stringify(cargoData))
    const service = makeService(mockReadFile)
    const result = (await service.getPortData('p1', 'cargo', '2020-06', '2025-06')) as Record<
      string,
      any
    >
    for (const d of result.indicators.cargo.historical) {
      expect(d.time >= '2020-06' && d.time <= '2025-06').toBe(true)
    }
    for (const d of result.indicators.cargo.forecast) {
      expect(d.time >= '2020-06' && d.time <= '2025-06').toBe(true)
    }
  })
})

describe('getIndicatorData', () => {
  it('不指定 portId 返回全部港口；指定则仅该港口', async () => {
    const mockReadFile = vi.fn().mockResolvedValue(JSON.stringify(cargoData))
    const service = makeService(mockReadFile)
    const all = (await service.getIndicatorData('cargo', '2020-01', undefined)) as {
      ports: Record<string, { portName: string }>
    }
    expect(Object.keys(all.ports).sort()).toEqual(['p1', 'p2'])
    const one = (await service.getIndicatorData('cargo', '2020-01', 'p1')) as {
      ports: Record<string, unknown>
    }
    expect(Object.keys(one.ports)).toEqual(['p1'])
  })

  it('时间匹配历史/预测取值；不匹配与缺参 value=null（0 值不被误判缺失）', async () => {
    const mockReadFile = vi.fn().mockResolvedValue(JSON.stringify(cargoData))
    const service = makeService(mockReadFile)
    const hist = (await service.getIndicatorData('cargo', '2020-01', 'p1')) as {
      ports: Record<string, { value: number }>
    }
    expect(hist.ports.p1.value).toBe(1000)
    const miss = (await service.getIndicatorData('cargo', '1999-01', 'p1')) as {
      ports: Record<string, { value: unknown }>
    }
    expect(miss.ports.p1.value).toBeNull()
    const noTime = (await service.getIndicatorData('cargo', undefined, 'p1')) as {
      ports: Record<string, { value: unknown }>
    }
    expect(noTime.ports.p1.value).toBeNull()
  })
})

describe('getTimeSeriesData', () => {
  it('拼接历史与预测（24+120=144 点）', async () => {
    const mockReadFile = vi.fn().mockResolvedValue(JSON.stringify(cargoData))
    const service = makeService(mockReadFile)
    const result = (await service.getTimeSeriesData(
      'cargo',
      'p1',
      undefined,
      undefined,
      undefined
    )) as Record<string, any>
    expect(result.series).toHaveLength(1)
    expect(result.series[0].data).toHaveLength(144)
    expect(result.series[0].data[0].time).toBe('2020-01')
    expect(result.granularity).toBe('month')
  })

  it('year 粒度按年聚合为 YYYY 且 value 为年均值整数', async () => {
    const mockReadFile = vi.fn().mockResolvedValue(JSON.stringify(cargoData))
    const service = makeService(mockReadFile)
    const result = (await service.getTimeSeriesData(
      'cargo',
      'p1',
      undefined,
      undefined,
      'year'
    )) as Record<string, any>
    const data = result.series[0].data
    for (const d of data) {
      expect(d.time).toMatch(/^\d{4}$/)
      expect(Number.isInteger(d.value)).toBe(true)
    }
    const years = data.map((d: { time: string }) => d.time)
    expect(years).toContain('2020')
    expect(years).toContain('2022')
  })

  it('不指定 portId 返回所有港口序列', async () => {
    const mockReadFile = vi.fn().mockResolvedValue(JSON.stringify(cargoData))
    const service = makeService(mockReadFile)
    const result = (await service.getTimeSeriesData(
      'cargo',
      undefined,
      undefined,
      undefined,
      undefined
    )) as {
      series: Array<{ portId: string }>
    }
    expect(result.series.map((s) => s.portId).sort()).toEqual(['p1', 'p2'])
  })
})

describe('validateIndicator', () => {
  it('缺参 400001 / 路径遍历 400001 / 未知指标 404001', async () => {
    const mockReadFile = vi.fn()
    const service = makeService(mockReadFile)
    await expect(service.getMapData(undefined as never, '2020')).rejects.toMatchObject({
      bizCode: 400001,
    })
    await expect(service.getMapData('../etc' as never, '2020')).rejects.toMatchObject({
      bizCode: 400001,
    })
    await expect(service.getMapData('cargoX' as never, '2020')).rejects.toMatchObject({
      bizCode: 404001,
    })
  })
})

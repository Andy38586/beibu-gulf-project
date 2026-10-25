import { Logger } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BusinessError } from '../src/common/errors/business-error'
import { DataFilesService } from '../src/infra/files/data-files.service'
import { ForecastService } from '../src/modules/forecast/services/forecast.service'

// forecastService 单测：mock reader（对齐 Express vi.mock fs/promises 模式），
// 覆盖缓存复用/ ENOENT→404/ 年聚合/ 缓存命中=重算不变量
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

const activityData = {
  indicator: 'activity',
  unit: '指数',
  data: {
    p1: {
      historical: makePortData('p1', '港口A').historical,
      forecast: [{ time: '2022-01', value: 120, type: 'forecast', reliability: 0.93 }],
      spatial: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [108.590379, 21.726917] },
            properties: { portId: 'p1', portName: '港口A' },
          },
        ],
      },
    },
  },
}

function makeEnoentError() {
  return Object.assign(new Error('not found'), { code: 'ENOENT' })
}

function makeService(mockReadFile: ReturnType<typeof vi.fn>): ForecastService {
  const files = new DataFilesService(mockReadFile as unknown as (p: string) => Promise<string>)
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

  it('缓存命中=重算不变量：热缓存结果与冷实例结果深等', async () => {
    const mockReadFile = vi.fn().mockResolvedValue(JSON.stringify(activityData))
    const warm = makeService(mockReadFile)
    const cold = makeService(mockReadFile)
    const first = await warm.getMapData('activity', '2022-01')
    const second = await warm.getMapData('activity', '2022-01') // 引擎缓存命中
    const fresh = await cold.getMapData('activity', '2022-01') // 全新实例（无缓存）
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(JSON.stringify(fresh)).toBe(JSON.stringify(first))
  })

  it('activity 派生指标：文件自带 forecast 透传 + 单位指数 + 真坐标锚点（非 mock 市区点）', async () => {
    const mockReadFile = vi.fn().mockResolvedValue(JSON.stringify(activityData))
    const service = makeService(mockReadFile)
    const result = (await service.getMapData('activity', '2022-01')) as any
    expect(result.type).toBe('FeatureCollection')
    expect(result.indicator).toBe('activity')
    expect(result.unit).toBe('指数')
    expect(result.features.length).toBeGreaterThan(0)
    // 散射点围绕锚点（ports 表真坐标 108.590379,21.726917 半径 ≤0.06°）——非 mock 市区点（108.62,21.95）
    const [lng, lat] = result.features[0].geometry.coordinates
    expect(Math.abs(lng - 108.590379)).toBeLessThan(0.06)
    expect(Math.abs(lat - 21.726917)).toBeLessThan(0.06)
    // 距 mock 市区锚点（108.62,21.95）显著更远，证明非旧坐标
    expect(
      Math.abs(lng - 108.62) > Math.abs(lng - 108.590379) ||
        Math.abs(lat - 21.95) > Math.abs(lat - 21.726917)
    ).toBe(true)
    expect(Object.keys(result.features[0].properties).sort()).toEqual(
      ['portId', 'portName', 'reliability', 'value'].sort()
    )
    // activity 走文件自带 forecast 透传分支：不读模型产物，仅 1 次读盘
    expect(mockReadFile).toHaveBeenCalledTimes(1)
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

describe('公开面收窄 — DEFAULT_READ_FILE 不得再导出', () => {
  // 本组是「公开面收窄」本身的判据——任何形式的再导出（export 关键字或 export { … } 列表）都必须红。
  it('内部符号不在模块公开面；公开符号仍在（阳性对照）', async () => {
    const mod = (await import('../src/infra/files/data-files.service')) as unknown as Record<
      string,
      unknown
    >
    const INTERNAL = ['DEFAULT_READ_FILE']
    const PUBLIC = ['DataFilesService']
    for (const k of INTERNAL) expect(mod[k], k + ' 应已收为模块内部').toBeUndefined()
    for (const k of PUBLIC) expect(mod[k], k + ' 应仍是公开面').toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// P1-1 降级可观测：预测响应的 metadata.dataSource
//
// 判据口径：模型产物命中 ⇒ 'model'；产物缺失/港口缺失（降级 computeForecast）⇒
// 'engine-fallback'。四个返回预测的端点必须同族一致——只标一处即未完成。
// ─────────────────────────────────────────────────────────────────────────────

type DataSourceResponse = { metadata?: { dataSource?: string } }

const MODEL_INFO = {
  method: 'holt-winters',
  training_period: '2018-01~2021-12',
  validation_period: '2021-01~2021-12',
  forecast_period: '2022-01~2030-12',
  data_source: 'official',
}

/** 模型产物港口段：predictions 必须晚于 cargoData 历史末点（2021-12），
 * 否则 interpolateMonthly 全部丢弃 → getModelForecast 返回 null，模型路径会被误判成降级 */
function modelPort(baseValue: number) {
  return {
    predictions: [
      { time: '2022-01', value: baseValue },
      { time: '2022-07', value: baseValue + 100 },
    ],
    backtest: {},
  }
}

/** 按路径分派的 reader：模型产物可控（ok/missing/partial），指标文件恒为 cargoData */
function makeModelReader(state: 'ok' | 'missing' | 'partial') {
  return vi.fn().mockImplementation((p: string) => {
    if (p.endsWith('throughput_model.json')) {
      if (state === 'missing') return Promise.reject(makeEnoentError())
      const ports =
        state === 'partial' ? { p1: modelPort(1200) } : { p1: modelPort(1200), p2: modelPort(2200) }
      return Promise.resolve(JSON.stringify({ model_info: MODEL_INFO, ports }))
    }
    if (p.endsWith('cargo.json')) return Promise.resolve(JSON.stringify(cargoData))
    return Promise.reject(makeEnoentError())
  })
}

describe('metadata.dataSource（P1-1 降级可观测）', () => {
  it('模型产物命中 → dataSource=model，且预测段确实来自产物（非外推）', async () => {
    const service = makeService(makeModelReader('ok'))
    const res = (await service.getTimeSeriesData(
      'cargo',
      'p1',
      undefined,
      undefined,
      undefined
    )) as DataSourceResponse & {
      series: Array<{ data: Array<{ time: string; value: number }> }>
    }
    expect(res.metadata?.dataSource).toBe('model')
    // 产物首点原值 1200：趋势外推不会恰好给出同一整数（证明走的模型分支而非默认值）
    expect(res.series[0].data.find((d) => d.time === '2022-01')?.value).toBe(1200)
  })

  it('模型产物读取失败 → dataSource=engine-fallback，四个预测端点一致 + 日志旁证仍在', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    const service = makeService(makeModelReader('missing'))

    const responses: Array<Record<string, unknown>> = [
      await service.getMapData('cargo', '2022-01'),
      await service.getTimeSeriesData('cargo', 'p1', undefined, undefined, undefined),
      await service.getIndicatorData('cargo', '2022-01', 'p1'),
      await service.getPortData('p1', 'cargo'),
    ]
    for (const res of responses) {
      expect((res as DataSourceResponse).metadata?.dataSource).toBe('engine-fallback')
    }
    // 日志是旁证、不是唯一事实：保留 logger.warn
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('模型产物缺某港口（部分降级）→ 响应整体标 engine-fallback（部分也须可见）', async () => {
    const service = makeService(makeModelReader('partial'))
    const res = (await service.getTimeSeriesData(
      'cargo',
      undefined,
      undefined,
      undefined,
      undefined
    )) as DataSourceResponse
    expect(res.metadata?.dataSource).toBe('engine-fallback')
  })

  it('activity 文件透传（真数据、非降级）→ 不写 dataSource（阴性对照）', async () => {
    const mockReadFile = vi.fn().mockResolvedValue(JSON.stringify(activityData))
    const service = makeService(mockReadFile)
    const res = (await service.getTimeSeriesData(
      'activity',
      'p1',
      undefined,
      undefined,
      undefined
    )) as DataSourceResponse
    expect(res.metadata?.dataSource).toBeUndefined()
  })

  it('运河情景叠加不丢标记（metadata 覆盖顺序）', async () => {
    const qinzhouCargo = { ...cargoData, data: { qinzhou: cargoData.data.p1 } }
    const reader = vi.fn().mockImplementation((p: string) => {
      if (p.endsWith('throughput_model.json')) {
        return Promise.resolve(
          JSON.stringify({ model_info: MODEL_INFO, ports: { qinzhou: modelPort(1200) } })
        )
      }
      if (p.endsWith('cargo.json')) return Promise.resolve(JSON.stringify(qinzhouCargo))
      return Promise.reject(makeEnoentError())
    })
    const service = makeService(reader)
    const res = (await service.getTimeSeriesData(
      'cargo',
      'qinzhou',
      undefined,
      undefined,
      undefined,
      1.0,
      'design'
    )) as DataSourceResponse & { canalScenario: string }
    expect(res.metadata?.dataSource).toBe('model')
    expect(res.canalScenario).toBe('design')
  })
})

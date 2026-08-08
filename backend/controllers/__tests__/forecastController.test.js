// @vitest-environment node
// forecastController 回归测试（R-12 confidence 钳制）
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BusinessError, ErrorCode } from '../../utils/BusinessError.js'

// 隔离 service 层，避免真实计算 / 文件 IO
vi.mock('../../services/forecastService.js', () => ({
  getMapData: vi.fn(),
  getPortData: vi.fn(),
  getIndicatorData: vi.fn(),
  getTimeSeriesData: vi.fn(),
}))

// 隔离 fs，避免依赖真实 public/data/forecast/index.json
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}))

import { readFile } from 'fs/promises'

import {
  getIndicatorData as queryIndicator,
  getMapData,
  getPortData,
  getTimeSeriesData as queryTimeSeries,
} from '../../services/forecastService.js'
import { _clearCacheForTest } from '../../utils/readStaticJson.js'
import {
  getForecastMapData,
  getForecastOverview,
  getIndicatorData,
  getPortForecast,
  getTimeSeriesData,
} from '../forecastController.js'

function createRes() {
  const res = { json: vi.fn(), status: vi.fn() }
  res.status.mockReturnValue(res)
  return res
}
function createNext() {
  return vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  // 统一只读缓存（readStaticJson）跨用例保留，必须清理避免用例间污染（与 flood 测试同模式）
  _clearCacheForTest()
})

describe('getForecastMapData', () => {
  it('缺少 indicator → next 收到 BusinessError(INVALID_PARAMS)', async () => {
    const req = { query: { time: '2025' } }
    const res = createRes()
    const next = createNext()
    await getForecastMapData(req, res, next)
    expect(next).toHaveBeenCalledTimes(1)
    const err = next.mock.calls[0][0]
    expect(err).toBeInstanceOf(BusinessError)
    expect(err.code).toBe(ErrorCode.INVALID_PARAMS.code)
    expect(res.json).not.toHaveBeenCalled()
  })

  it('缺少 time → next 收到 BusinessError(INVALID_PARAMS)', async () => {
    const req = { query: { indicator: 'cargo' } }
    const res = createRes()
    const next = createNext()
    await getForecastMapData(req, res, next)
    expect(next).toHaveBeenCalledTimes(1)
    const err = next.mock.calls[0][0]
    expect(err).toBeInstanceOf(BusinessError)
    expect(err.code).toBe(ErrorCode.INVALID_PARAMS.code)
    expect(res.json).not.toHaveBeenCalled()
  })

  it('参数齐全 → res.json({code:200,data})，data 来自 mock service', async () => {
    const mockData = { indicator: 'cargo', unit: '万吨', features: [] }
    getMapData.mockResolvedValue(mockData)
    const req = { query: { indicator: 'cargo', time: '2025', confidence: '0.9' } }
    const res = createRes()
    const next = createNext()
    await getForecastMapData(req, res, next)
    expect(getMapData).toHaveBeenCalledWith('cargo', '2025', 0.9)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ code: 200, data: mockData })
    expect(next).not.toHaveBeenCalled()
  })

  it('缺省 confidence → 以 1.0 调用 getMapData', async () => {
    const mockData = { indicator: 'berth', features: [] }
    getMapData.mockResolvedValue(mockData)
    const req = { query: { indicator: 'berth', time: '2025' } }
    const res = createRes()
    const next = createNext()
    await getForecastMapData(req, res, next)
    expect(getMapData).toHaveBeenCalledWith('berth', '2025', 1.0)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ code: 200, data: mockData })
  })

  it('service 抛错 → next(error)', async () => {
    const boom = new Error('compute failed')
    getMapData.mockRejectedValue(boom)
    const req = { query: { indicator: 'cargo', time: '2025' } }
    const res = createRes()
    const next = createNext()
    await getForecastMapData(req, res, next)
    expect(next).toHaveBeenCalledWith(boom)
    expect(res.json).not.toHaveBeenCalled()
  })
})

describe('getForecastOverview', () => {
  it('正常 → res.json({code:200,data})，data 来自 mock readFile', async () => {
    const indexData = { ports: ['A', 'B'], updatedAt: '2025-01-01' }
    readFile.mockResolvedValue(JSON.stringify(indexData))
    const req = {}
    const res = createRes()
    const next = createNext()
    await getForecastOverview(req, res, next)
    expect(readFile).toHaveBeenCalledTimes(1)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ code: 200, data: indexData })
    expect(next).not.toHaveBeenCalled()
  })

  it('readFile 抛错 → next(error)', async () => {
    const boom = new Error('ENOENT')
    readFile.mockRejectedValue(boom)
    const req = {}
    const res = createRes()
    const next = createNext()
    await getForecastOverview(req, res, next)
    expect(next).toHaveBeenCalledWith(boom)
    expect(res.json).not.toHaveBeenCalled()
  })

  it('REQ-3：连续两次调用只读盘 1 次（5min TTL 缓存命中）', async () => {
    const indexData = { ports: ['A', 'B'], updatedAt: '2025-01-01' }
    readFile.mockResolvedValue(JSON.stringify(indexData))
    const req = {}
    const res = createRes()
    const next = createNext()
    await getForecastOverview(req, res, next)
    await getForecastOverview(req, res, next)
    expect(readFile).toHaveBeenCalledTimes(1)
    expect(res.json).toHaveBeenCalledTimes(2)
  })
})

describe('getPortForecast', () => {
  it('正常 → res.json({code:200,data})，data 来自 mock service', async () => {
    const mockData = { portId: 'p1', portName: '钦州港', indicators: {} }
    getPortData.mockResolvedValue(mockData)
    const req = {
      params: { portId: 'p1' },
      query: { indicator: 'cargo', start: '2024', end: '2025' },
    }
    const res = createRes()
    const next = createNext()
    await getPortForecast(req, res, next)
    expect(getPortData).toHaveBeenCalledWith('p1', 'cargo', '2024', '2025')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ code: 200, data: mockData })
    expect(next).not.toHaveBeenCalled()
  })

  it('service 抛错 → next(error)', async () => {
    const boom = new Error('port not found')
    getPortData.mockRejectedValue(boom)
    const req = { params: { portId: 'pX' }, query: {} }
    const res = createRes()
    const next = createNext()
    await getPortForecast(req, res, next)
    expect(next).toHaveBeenCalledWith(boom)
    expect(res.json).not.toHaveBeenCalled()
  })
})

describe('getIndicatorData', () => {
  it('正常 → res.json({code:200,data})，data 来自 mock service', async () => {
    const mockData = { indicator: 'cargo', unit: '万吨', ports: {} }
    queryIndicator.mockResolvedValue(mockData)
    const req = { params: { type: 'cargo' }, query: { time: '2025', portId: 'p1' } }
    const res = createRes()
    const next = createNext()
    await getIndicatorData(req, res, next)
    expect(queryIndicator).toHaveBeenCalledWith('cargo', '2025', 'p1', 1.0)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ code: 200, data: mockData })
    expect(next).not.toHaveBeenCalled()
  })

  it('service 抛错 → next(error)', async () => {
    const boom = new Error('indicator failed')
    queryIndicator.mockRejectedValue(boom)
    const req = { params: { type: 'cargo' }, query: {} }
    const res = createRes()
    const next = createNext()
    await getIndicatorData(req, res, next)
    expect(next).toHaveBeenCalledWith(boom)
    expect(res.json).not.toHaveBeenCalled()
  })
})

describe('getTimeSeriesData', () => {
  it('正常 → res.json({code:200,data})，data 来自 mock service', async () => {
    const mockData = { indicator: 'cargo', unit: '万吨', granularity: 'year', series: [] }
    queryTimeSeries.mockResolvedValue(mockData)
    const req = {
      query: { indicator: 'cargo', portId: 'p1', start: '2024', end: '2025', granularity: 'year' },
    }
    const res = createRes()
    const next = createNext()
    await getTimeSeriesData(req, res, next)
    expect(queryTimeSeries).toHaveBeenCalledWith('cargo', 'p1', '2024', '2025', 'year', 1.0)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ code: 200, data: mockData })
    expect(next).not.toHaveBeenCalled()
  })

  it('service 抛错 → next(error)', async () => {
    const boom = new Error('series failed')
    queryTimeSeries.mockRejectedValue(boom)
    const req = { query: { indicator: 'cargo' } }
    const res = createRes()
    const next = createNext()
    await getTimeSeriesData(req, res, next)
    expect(next).toHaveBeenCalledWith(boom)
    expect(res.json).not.toHaveBeenCalled()
  })
})

describe('confidence 钳制 (REQ-4)', () => {
  it('getForecastMapData: 非法 confidence 回落 1.0', async () => {
    getMapData.mockResolvedValue({ features: [] })
    const cases = ['-5', '0', 'abc', '1e999', 'Infinity']
    for (const c of cases) {
      const req = { query: { indicator: 'cargo', time: '2025', confidence: c } }
      const res = createRes()
      const next = createNext()
      await getForecastMapData(req, res, next)
      expect(getMapData).toHaveBeenLastCalledWith('cargo', '2025', 1.0)
    }
  })

  it('getForecastMapData: 合法 confidence 原样传递', async () => {
    getMapData.mockResolvedValue({ features: [] })
    const req = { query: { indicator: 'cargo', time: '2025', confidence: '1.5' } }
    const res = createRes()
    const next = createNext()
    await getForecastMapData(req, res, next)
    expect(getMapData).toHaveBeenCalledWith('cargo', '2025', 1.5)
  })

  it('getForecastMapData: 超过上限 2 钳制为 2', async () => {
    getMapData.mockResolvedValue({ features: [] })
    const req = { query: { indicator: 'cargo', time: '2025', confidence: '5' } }
    const res = createRes()
    const next = createNext()
    await getForecastMapData(req, res, next)
    expect(getMapData).toHaveBeenCalledWith('cargo', '2025', 2)
  })

  it('getIndicatorData: 非法 confidence 回落 1.0', async () => {
    queryIndicator.mockResolvedValue({ indicator: 'cargo', unit: '万吨', ports: {} })
    const req = {
      params: { type: 'cargo' },
      query: { time: '2025', portId: 'p1', confidence: 'abc' },
    }
    const res = createRes()
    const next = createNext()
    await getIndicatorData(req, res, next)
    expect(queryIndicator).toHaveBeenCalledWith('cargo', '2025', 'p1', 1.0)
  })

  it('getTimeSeriesData: 非法 confidence 回落 1.0', async () => {
    queryTimeSeries.mockResolvedValue({
      indicator: 'cargo',
      unit: '万吨',
      granularity: 'year',
      series: [],
    })
    const req = {
      query: {
        indicator: 'cargo',
        portId: 'p1',
        start: '2024',
        end: '2025',
        granularity: 'year',
        confidence: '-5',
      },
    }
    const res = createRes()
    const next = createNext()
    await getTimeSeriesData(req, res, next)
    expect(queryTimeSeries).toHaveBeenCalledWith('cargo', 'p1', '2024', '2025', 'year', 1.0)
  })
})

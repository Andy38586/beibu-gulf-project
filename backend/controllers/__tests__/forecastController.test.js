// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
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
  getForecastOverview,
  getForecastMapData,
  getPortForecast,
  getIndicatorData,
  getTimeSeriesData,
} from '../forecastController.js'
import {
  getMapData,
  getPortData,
  getIndicatorData as queryIndicator,
  getTimeSeriesData as queryTimeSeries,
} from '../../services/forecastService.js'

function createRes() {
  return { json: vi.fn() }
}
function createNext() {
  return vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
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
    const req = { query: { indicator: 'throughput' } }
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
    const mockData = { indicator: 'throughput', unit: '万吨', features: [] }
    getMapData.mockResolvedValue(mockData)
    const req = { query: { indicator: 'throughput', time: '2025', confidence: '0.9' } }
    const res = createRes()
    const next = createNext()
    await getForecastMapData(req, res, next)
    expect(getMapData).toHaveBeenCalledWith('throughput', '2025', 0.9)
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
    expect(res.json).toHaveBeenCalledWith({ code: 200, data: mockData })
  })

  it('service 抛错 → next(error)', async () => {
    const boom = new Error('compute failed')
    getMapData.mockRejectedValue(boom)
    const req = { query: { indicator: 'throughput', time: '2025' } }
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
})

describe('getPortForecast', () => {
  it('正常 → res.json({code:200,data})，data 来自 mock service', async () => {
    const mockData = { portId: 'p1', portName: '钦州港', indicators: {} }
    getPortData.mockResolvedValue(mockData)
    const req = { params: { portId: 'p1' }, query: { indicator: 'throughput', start: '2024', end: '2025' } }
    const res = createRes()
    const next = createNext()
    await getPortForecast(req, res, next)
    expect(getPortData).toHaveBeenCalledWith('p1', 'throughput', '2024', '2025')
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
    const mockData = { indicator: 'throughput', unit: '万吨', ports: {} }
    queryIndicator.mockResolvedValue(mockData)
    const req = { params: { type: 'throughput' }, query: { time: '2025', portId: 'p1' } }
    const res = createRes()
    const next = createNext()
    await getIndicatorData(req, res, next)
    expect(queryIndicator).toHaveBeenCalledWith('throughput', '2025', 'p1', 1.0)
    expect(res.json).toHaveBeenCalledWith({ code: 200, data: mockData })
    expect(next).not.toHaveBeenCalled()
  })

  it('service 抛错 → next(error)', async () => {
    const boom = new Error('indicator failed')
    queryIndicator.mockRejectedValue(boom)
    const req = { params: { type: 'throughput' }, query: {} }
    const res = createRes()
    const next = createNext()
    await getIndicatorData(req, res, next)
    expect(next).toHaveBeenCalledWith(boom)
    expect(res.json).not.toHaveBeenCalled()
  })
})

describe('getTimeSeriesData', () => {
  it('正常 → res.json({code:200,data})，data 来自 mock service', async () => {
    const mockData = { indicator: 'throughput', unit: '万吨', granularity: 'year', series: [] }
    queryTimeSeries.mockResolvedValue(mockData)
    const req = {
      query: { indicator: 'throughput', portId: 'p1', start: '2024', end: '2025', granularity: 'year' },
    }
    const res = createRes()
    const next = createNext()
    await getTimeSeriesData(req, res, next)
    expect(queryTimeSeries).toHaveBeenCalledWith('throughput', 'p1', '2024', '2025', 'year', 1.0)
    expect(res.json).toHaveBeenCalledWith({ code: 200, data: mockData })
    expect(next).not.toHaveBeenCalled()
  })

  it('service 抛错 → next(error)', async () => {
    const boom = new Error('series failed')
    queryTimeSeries.mockRejectedValue(boom)
    const req = { query: { indicator: 'throughput' } }
    const res = createRes()
    const next = createNext()
    await getTimeSeriesData(req, res, next)
    expect(next).toHaveBeenCalledWith(boom)
    expect(res.json).not.toHaveBeenCalled()
  })
})

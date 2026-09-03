// @vitest-environment node
/**
 * forecast 路由分发测试（R-1/b026 回归防线）
 * 背景：前端 forecastAdapter.ts:349 调 GET /forecast/overview 获取可用指标索引。
 * 修复前后端无 /overview 路由，请求落入 /:portId → getPortForecast('overview') → 空数据。
 * 本测试锁定：/overview 必须分发到 getForecastOverview，而非被 /:portId 兜底。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 隔离 controller 层，避免真实文件 IO
vi.mock('../../controllers/forecastController.js', () => ({
  getForecastOverview: vi.fn((req, res) => res.json({ code: 200, data: { overview: true } })),
  getForecastMapData: vi.fn((req, res) => res.json({ code: 200, data: { map: true } })),
  getPortForecast: vi.fn((req, res) =>
    res.json({ code: 200, data: { portId: req.params.portId, indicators: {} } })
  ),
  getIndicatorData: vi.fn((req, res) => res.json({ code: 200, data: { indicator: true } })),
  getTimeSeriesData: vi.fn((req, res) => res.json({ code: 200, data: { series: true } })),
}))

import * as forecastController from '../../controllers/forecastController.js'
import forecastRouter from '../forecast.js'

/** 简化请求对象（express router 测试所需的最小字段） */
function mockReq(method, url) {
  return { method, url, params: {}, query: {}, body: {}, headers: {} }
}

function mockRes() {
  const res = { statusCode: 200, json: vi.fn((data) => data), status: vi.fn() }
  res.status.mockReturnValue(res)
  return res
}

/** 用 express router 的 handle 直接分发一次请求 */
function dispatch(method, url) {
  return new Promise((resolve) => {
    const req = mockReq(method, url)
    const res = mockRes()
    forecastRouter.handle(req, res, () => {})
    resolve(res)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('forecast 路由分发', () => {
  it('GET /overview 应分发到 getForecastOverview（修复 R-1）', async () => {
    const res = await dispatch('GET', '/overview')
    expect(forecastController.getForecastOverview).toHaveBeenCalledTimes(1)
    expect(forecastController.getPortForecast).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalled()
  })

  it('GET / 也应分发到 getForecastOverview（根路径兼容）', async () => {
    await dispatch('GET', '/')
    expect(forecastController.getForecastOverview).toHaveBeenCalledTimes(1)
  })

  it('GET /QZ 应分发到 getPortForecast（港口查询不受影响）', async () => {
    const res = await dispatch('GET', '/QZ')
    expect(forecastController.getPortForecast).toHaveBeenCalledTimes(1)
    expect(forecastController.getForecastOverview).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalled()
  })

  it('GET /map 应分发到 getForecastMapData', async () => {
    await dispatch('GET', '/map')
    expect(forecastController.getForecastMapData).toHaveBeenCalledTimes(1)
    expect(forecastController.getPortForecast).not.toHaveBeenCalled()
  })
})

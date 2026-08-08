// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BusinessError } from '../../utils/BusinessError.js'

// 隔离 fs，避免依赖真实数据文件
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}))

import { readFile } from 'fs/promises'

import { _cache, _clearCacheForTest, readStaticJson } from '../../utils/readStaticJson.js'
import {
  analyzeDisaster,
  getFloodAreas,
  getFloodStatistics,
  getWaterArea,
} from '../floodAnalysisController.js'

// 构造 mock req/res/next
function mockReqRes(query = {}, body = {}) {
  const req = { query, body }
  const res = {
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
  }
  const next = vi.fn()
  return { req, res, next }
}

const MOCK_FLOOD_AREA = JSON.stringify({
  floodZones: [
    { waterLevel: 1.0, riskLevel: '低风险', features: [] },
    { waterLevel: 3.0, riskLevel: '中风险', features: [] },
    { waterLevel: 5.0, riskLevel: '高风险', features: [] },
  ],
})

const MOCK_STATISTICS = JSON.stringify({
  statistics: [
    { waterLevel: 1.0, floodArea: 0.5 },
    { waterLevel: 3.0, floodArea: 2.0 },
    { waterLevel: 5.0, floodArea: 5.0 },
  ],
})

// b032 / D-4=A：水域坐标端点 fixture（结构与 backend/data/flood/water-area.json 同构）
const MOCK_WATER_AREA = JSON.stringify({
  id: 'main-water-area',
  name: '钦州港附近海域',
  coordinates: [
    [108.615, 21.855],
    [108.62, 21.855],
    [108.622, 21.858],
  ],
})

describe('floodAnalysisController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _clearCacheForTest()
  })

  describe('getFloodAreas - 水位校验 (d034)', () => {
    it('正常水位应返回 200', async () => {
      readFile.mockResolvedValue(MOCK_FLOOD_AREA)
      const { req, res, next } = mockReqRes({ waterLevel: '2.5' })
      await getFloodAreas(req, res, next)
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 200 }))
    })

    it('Infinity 应触发业务错误', async () => {
      const { req, res, next } = mockReqRes({ waterLevel: 'Infinity' })
      await getFloodAreas(req, res, next)
      expect(next).toHaveBeenCalledWith(expect.any(BusinessError))
    })

    it('负数应触发业务错误', async () => {
      const { req, res, next } = mockReqRes({ waterLevel: '-5' })
      await getFloodAreas(req, res, next)
      expect(next).toHaveBeenCalledWith(expect.any(BusinessError))
    })

    it('超过上限 100 应触发业务错误', async () => {
      const { req, res, next } = mockReqRes({ waterLevel: '150' })
      await getFloodAreas(req, res, next)
      expect(next).toHaveBeenCalledWith(expect.any(BusinessError))
    })

    it('非数字应触发业务错误', async () => {
      const { req, res, next } = mockReqRes({ waterLevel: 'abc' })
      await getFloodAreas(req, res, next)
      expect(next).toHaveBeenCalledWith(expect.any(BusinessError))
    })

    it('向上取档：请求 2.5 应返回 3.0 档位', async () => {
      readFile.mockResolvedValue(MOCK_FLOOD_AREA)
      const { req, res, next } = mockReqRes({ waterLevel: '2.5' })
      await getFloodAreas(req, res, next)
      const response = res.json.mock.calls[0][0]
      expect(response.data.actualWaterLevel).toBe(3.0)
      expect(response.data.requestedWaterLevel).toBe(2.5)
    })
  })

  describe('getFloodStatistics - 水位校验', () => {
    it('正常水位应返回统计数据', async () => {
      readFile.mockResolvedValue(MOCK_STATISTICS)
      const { req, res, next } = mockReqRes({ waterLevel: '3.0' })
      await getFloodStatistics(req, res, next)
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 200 }))
    })

    it('Infinity 应触发业务错误', async () => {
      const { req, res, next } = mockReqRes({ waterLevel: 'Infinity' })
      await getFloodStatistics(req, res, next)
      expect(next).toHaveBeenCalledWith(expect.any(BusinessError))
    })
  })

  describe('analyzeDisaster - 水位校验', () => {
    it('缺少水位应触发业务错误', async () => {
      const { req, res, next } = mockReqRes({}, {})
      await analyzeDisaster(req, res, next)
      expect(next).toHaveBeenCalledWith(expect.any(BusinessError))
    })

    it('Infinity 应触发业务错误', async () => {
      const { req, res, next } = mockReqRes({}, { waterLevel: 'Infinity' })
      await analyzeDisaster(req, res, next)
      expect(next).toHaveBeenCalledWith(expect.any(BusinessError))
    })
  })

  describe('getWaterArea - 水域坐标端点 (b032 / D-4=A)', () => {
    it('正常应返回坐标数组（data 为 [[lng,lat],...]）', async () => {
      readFile.mockResolvedValue(MOCK_WATER_AREA)
      const { req, res, next } = mockReqRes()
      await getWaterArea(req, res, next)
      expect(next).not.toHaveBeenCalled()
      const response = res.json.mock.calls[0][0]
      expect(response.code).toBe(200)
      expect(Array.isArray(response.data)).toBe(true)
      expect(response.data).toHaveLength(3)
      expect(response.data[0]).toEqual([108.615, 21.855])
    })

    it('coordinates 缺失应触发业务错误（NOT_FOUND）', async () => {
      readFile.mockResolvedValue(JSON.stringify({ id: 'x', name: 'x' }))
      const { req, res, next } = mockReqRes()
      await getWaterArea(req, res, next)
      expect(next).toHaveBeenCalledWith(expect.any(BusinessError))
      const err = next.mock.calls[0][0]
      expect(err.status).toBe(404)
    })

    it('coordinates 为空数组应触发业务错误', async () => {
      readFile.mockResolvedValue(JSON.stringify({ id: 'x', name: 'x', coordinates: [] }))
      const { req, res, next } = mockReqRes()
      await getWaterArea(req, res, next)
      expect(next).toHaveBeenCalledWith(expect.any(BusinessError))
    })
  })

  describe('readStaticJson（utils 统一入口） - 读盘缓存 (REQ-3)', () => {
    it('getFloodAreas 连续两次调用只读盘一次', async () => {
      readFile.mockResolvedValue(MOCK_FLOOD_AREA)
      const { req, res, next } = mockReqRes({ waterLevel: '2.5' })
      await getFloodAreas(req, res, next)
      await getFloodAreas(req, res, next)
      expect(readFile).toHaveBeenCalledTimes(1)
    })

    it('TTL 过期后重新读盘', async () => {
      const nowSpy = vi.spyOn(Date, 'now')
      let t = 1_700_000_000_000
      nowSpy.mockImplementation(() => t)
      try {
        readFile.mockResolvedValue(MOCK_FLOOD_AREA)
        const { req, res, next } = mockReqRes({ waterLevel: '2.5' })
        await getFloodAreas(req, res, next)
        expect(readFile).toHaveBeenCalledTimes(1)
        t += 6 * 60 * 1000
        await getFloodAreas(req, res, next)
        expect(readFile).toHaveBeenCalledTimes(2)
      } finally {
        nowSpy.mockRestore()
      }
    })
  })

  describe('readStaticJson（utils 统一入口） - 缓存大小上限 (z050-BE)', () => {
    it('超过上限淘汰最旧条目，保留最新', async () => {
      readFile.mockImplementation((p) => Promise.resolve(JSON.stringify({ f: String(p) })))
      _clearCacheForTest()
      for (let i = 0; i < 25; i++) {
        await readStaticJson(`file${i}.json`)
      }
      // 上限 20，最旧 file0 应被淘汰，最新 file24 应保留
      expect(_cache.size).toBeLessThanOrEqual(20)
      expect(_cache.has('file0.json')).toBe(false)
      expect(_cache.has('file24.json')).toBe(true)
    })
  })
})

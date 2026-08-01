// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BusinessError } from '../../utils/BusinessError.js'

// 隔离 fs，避免依赖真实数据文件
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}))

import { readFile } from 'fs/promises'
import { getFloodAreas, getFloodStatistics, analyzeDisaster } from '../floodAnalysisController.js'

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

describe('floodAnalysisController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getFloodAreas - 水位校验 (d034)', () => {
    it('正常水位应返回 200', async () => {
      readFile.mockResolvedValue(MOCK_FLOOD_AREA)
      const { req, res, next } = mockReqRes({ waterLevel: '2.5' })
      await getFloodAreas(req, res, next)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 200 })
      )
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
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 200 })
      )
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
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BusinessError } from '../src/common/errors/business-error'
import { DataFilesService, DEFAULT_READ_FILE } from '../src/infra/files/data-files.service'
import { deriveRiskLevel, FloodController } from '../src/modules/flood/flood.controller'
import { FloodRepository } from '../src/modules/flood/flood.repository'
import { FloodService } from '../src/modules/flood/flood.service'

// floodController 单测：移植 Express controllers/__tests__/floodAnalysisController.test.js
// 20 用例语义（mock reader 对齐 Express vi.mock fs/promises 模式），
// 覆盖：水位校验四态 / 6 档向上取档 / 等值命中 / deriveRiskLevel 表 / water-area 三态 /
// 缓存读一次 / TTL 过期（Date.now spy）/ LRU 淘汰
const MOCK_FLOOD_AREA = JSON.stringify({
  floodZones: [
    { waterLevel: 1.0, riskLevel: '低风险', features: [{ type: 'Feature', properties: {} }] },
    { waterLevel: 3.0, riskLevel: '中风险', features: [{ type: 'Feature', properties: {} }] },
    { waterLevel: 5.0, riskLevel: '高风险', features: [{ type: 'Feature', properties: {} }] },
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

const MOCK_FACILITY = {
  id: 'QZ-001',
  name: '三墩港口',
  type: '港口码头',
  port: '钦州港',
  lng: 108.697,
  lat: 21.61,
  elevation: 12.0,
  value: 15000,
  damageRate: 0.85,
}

// disaster 链路夹具：设施点（与下方 assessDisaster describe 的 FACILITIES[0] 同点位）
const MOCK_FACILITIES = JSON.stringify({ facilities: [MOCK_FACILITY] })

function makeController(mockReadFile: ReturnType<typeof vi.fn>): FloodController {
  const files = new DataFilesService(mockReadFile as unknown as typeof DEFAULT_READ_FILE)
  const repository = new FloodRepository(files)
  return new FloodController(repository, new FloodService())
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('getFloodAreas - 水位校验 (d034)', () => {
  it('正常水位应返回档位数据', async () => {
    const controller = makeController(vi.fn().mockResolvedValue(MOCK_FLOOD_AREA))
    const result = (await controller.getFloodAreas('2.5')) as { actualWaterLevel: number }
    expect(result.actualWaterLevel).toBe(3.0)
  })

  it('Infinity 应触发业务错误', async () => {
    const controller = makeController(vi.fn().mockResolvedValue(MOCK_FLOOD_AREA))
    await expect(controller.getFloodAreas('Infinity')).rejects.toBeInstanceOf(BusinessError)
    await expect(controller.getFloodAreas('Infinity')).rejects.toMatchObject({ bizCode: 400001 })
  })

  it('负数应触发业务错误', async () => {
    const controller = makeController(vi.fn().mockResolvedValue(MOCK_FLOOD_AREA))
    await expect(controller.getFloodAreas('-5')).rejects.toBeInstanceOf(BusinessError)
  })

  it('超过上限 25 应触发业务错误（8-11：与 FastAPI le=25 对齐）', async () => {
    const controller = makeController(vi.fn().mockResolvedValue(MOCK_FLOOD_AREA))
    await expect(controller.getFloodAreas('150')).rejects.toBeInstanceOf(BusinessError)
  })

  it('26-100 之间的越界水位应触发业务错误（8-11：原 MAX=100 放行）', async () => {
    const controller = makeController(vi.fn().mockResolvedValue(MOCK_FLOOD_AREA))
    await expect(controller.getFloodAreas('30')).rejects.toBeInstanceOf(BusinessError)
  })

  it('非数字应触发业务错误', async () => {
    const controller = makeController(vi.fn().mockResolvedValue(MOCK_FLOOD_AREA))
    await expect(controller.getFloodAreas('abc')).rejects.toBeInstanceOf(BusinessError)
  })

  it('api 模式 6 档向上取档：请求 2.5 → actual 3.0（8-2/8-3 回退设计，宁可高估）', async () => {
    const controller = makeController(vi.fn().mockResolvedValue(MOCK_FLOOD_AREA))
    const result = (await controller.getFloodAreas('2.5')) as Record<string, unknown> & {
      actualWaterLevel: number
      requestedWaterLevel: number
      riskLevel: string
      features: Array<{ properties: Record<string, unknown> }>
    }
    expect(result.actualWaterLevel).toBe(3.0)
    expect(result.requestedWaterLevel).toBe(2.5)
    // riskLevel 与 actual 档位一致（3.0 档中风险）
    expect(result.riskLevel).toBe('中风险')
    expect(result.features[0].properties.riskLevel).toBe('中风险')
  })

  it('水位恰为档位值（5.0）→ 命中该档（向上取档含等值）', async () => {
    const controller = makeController(vi.fn().mockResolvedValue(MOCK_FLOOD_AREA))
    const result = (await controller.getFloodAreas('5')) as {
      actualWaterLevel: number
      riskLevel: string
    }
    expect(result.actualWaterLevel).toBe(5.0)
    expect(result.riskLevel).toBe('高风险')
  })

  it('无 251 查表：2.5 直接 6 档向上取 3.0（8-2/8-3 语义）', async () => {
    const controller = makeController(vi.fn().mockResolvedValue(MOCK_FLOOD_AREA))
    const result = (await controller.getFloodAreas('2.5')) as {
      actualWaterLevel: number
      requestedWaterLevel: number
    }
    expect(result.actualWaterLevel).toBe(3.0)
    expect(result.requestedWaterLevel).toBe(2.5)
  })

  it('未指定水位 → 返回全部淹没范围', async () => {
    const controller = makeController(vi.fn().mockResolvedValue(MOCK_FLOOD_AREA))
    const result = (await controller.getFloodAreas()) as Array<{ waterLevel: number }>
    expect(result).toHaveLength(3)
    expect(result.map((z) => z.waterLevel)).toEqual([1.0, 3.0, 5.0])
  })
})

describe('deriveRiskLevel - 连续档位风险派生', () => {
  it('语义对齐 6 档基准（0/2/5/8/10/15）', () => {
    expect(deriveRiskLevel(0)).toBe('无风险')
    expect(deriveRiskLevel(2)).toBe('低风险')
    expect(deriveRiskLevel(5)).toBe('中风险')
    expect(deriveRiskLevel(8)).toBe('高风险')
    expect(deriveRiskLevel(10)).toBe('极高风险')
    expect(deriveRiskLevel(15)).toBe('灾难级')
    expect(deriveRiskLevel(12.5)).toBe('灾难级')
    expect(deriveRiskLevel(3.5)).toBe('中风险')
  })
})

describe('getFloodStatistics - 水位校验', () => {
  it('正常水位应返回统计数据（向上取档）', async () => {
    const controller = makeController(vi.fn().mockResolvedValue(MOCK_STATISTICS))
    const result = (await controller.getFloodStatistics('3.0')) as Record<string, unknown>
    expect(result).toMatchObject({ waterLevel: 3.0, floodArea: 2.0 })
  })

  it('Infinity 应触发业务错误', async () => {
    const controller = makeController(vi.fn().mockResolvedValue(MOCK_STATISTICS))
    await expect(controller.getFloodStatistics('Infinity')).rejects.toBeInstanceOf(BusinessError)
  })

  it('超档（>5）取最高档兜底，不静默返 null', async () => {
    const controller = makeController(vi.fn().mockResolvedValue(MOCK_STATISTICS))
    const result = (await controller.getFloodStatistics('4.9')) as { waterLevel: number }
    expect(result.waterLevel).toBe(5.0)
  })

  it('未指定水位 → 返回全部统计', async () => {
    const controller = makeController(vi.fn().mockResolvedValue(MOCK_STATISTICS))
    const result = (await controller.getFloodStatistics()) as unknown[]
    expect(result).toHaveLength(3)
  })
})

describe('analyzeDisaster - 水位校验', () => {
  it('缺少水位应触发业务错误（文案逐字节）', async () => {
    const controller = makeController(vi.fn())
    await expect(controller.analyzeDisaster({})).rejects.toMatchObject({
      bizCode: 400001,
      message: '缺少水位参数',
    })
  })

  it('body 为空（无 JSON 体）同样触发缺少水位参数', async () => {
    const controller = makeController(vi.fn())
    await expect(controller.analyzeDisaster(undefined)).rejects.toMatchObject({
      bizCode: 400001,
    })
  })

  it('Infinity 应触发业务错误', async () => {
    const controller = makeController(vi.fn())
    await expect(controller.analyzeDisaster({ waterLevel: 'Infinity' })).rejects.toBeInstanceOf(
      BusinessError
    )
  })
})

describe('floodService.assessDisaster - 空间筛选与损失计算', () => {
  const FACILITIES = [
    MOCK_FACILITY,
    {
      id: 'QZ-002',
      name: '内陆高点',
      type: '仓储',
      port: '钦州港',
      lng: 109.5,
      lat: 22.5,
      elevation: 30.0,
      value: 99999,
      damageRate: 0.5,
    },
  ]
  // 覆盖 QZ-001（108.697, 21.61）的小多边形
  const FLOOD_ZONE = {
    waterLevel: 5,
    riskLevel: '中风险',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [108.69, 21.6],
              [108.71, 21.6],
              [108.71, 21.62],
              [108.69, 21.62],
              [108.69, 21.6],
            ],
          ],
        },
        properties: {},
      },
    ],
  }

  it('点在淹没多边形内 → loss=value×damageRate，多边形外不计入', () => {
    const service = new FloodService()
    const result = service.assessDisaster(FACILITIES, 5, FLOOD_ZONE)
    expect(result.affectedFacilities).toHaveLength(1)
    expect(result.affectedFacilities[0].loss).toBe(15000 * 0.85)
    expect(result.totalLoss).toBe(Math.round(15000 * 0.85))
    expect(result.riskLevel).toBe('中风险')
    expect(result.waterLevel).toBe(5)
  })

  it('无淹没档位（0 档/null）→ 无风险 + 零损失 + waterLevel undefined', () => {
    const service = new FloodService()
    for (const zone of [null, { waterLevel: 0, riskLevel: '无风险', features: [] }]) {
      const result = service.assessDisaster(FACILITIES, 0, zone)
      expect(result).toEqual({
        affectedFacilities: [],
        totalLoss: 0,
        riskLevel: '无风险',
        waterLevel: undefined,
      })
    }
  })

  it('value/damageRate 非数值按 0 计（合法 0 保留）', () => {
    const service = new FloodService()
    const dirty = [{ ...FACILITIES[0], value: NaN, damageRate: undefined as unknown as number }]
    const result = service.assessDisaster(dirty, 5, FLOOD_ZONE)
    expect(result.affectedFacilities[0].loss).toBe(0)
    expect(result.totalLoss).toBe(0)
  })
})

describe('getWaterArea - 水域坐标端点 (b032 / D-4=A)', () => {
  it('正常应返回坐标数组（data 为 [[lng,lat],...]）', async () => {
    const controller = makeController(vi.fn().mockResolvedValue(MOCK_WATER_AREA))
    const result = (await controller.getWaterArea()) as number[][]
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual([108.615, 21.855])
  })

  it('coordinates 缺失应触发业务错误（NOT_FOUND 404001）', async () => {
    const controller = makeController(
      vi.fn().mockResolvedValue(JSON.stringify({ id: 'x', name: 'x' }))
    )
    await expect(controller.getWaterArea()).rejects.toMatchObject({
      bizCode: 404001,
      status: 404,
    })
  })

  it('coordinates 为空数组应触发业务错误', async () => {
    const controller = makeController(
      vi.fn().mockResolvedValue(JSON.stringify({ id: 'x', name: 'x', coordinates: [] }))
    )
    await expect(controller.getWaterArea()).rejects.toBeInstanceOf(BusinessError)
  })
})

describe('DataFilesService 统一入口 - 读盘缓存 (REQ-3 / z050-BE)', () => {
  it('getFloodAreas 连续两次调用只读盘一次', async () => {
    const mockReadFile = vi.fn().mockResolvedValue(MOCK_FLOOD_AREA)
    const files = new DataFilesService(mockReadFile as unknown as typeof DEFAULT_READ_FILE)
    const controller = new FloodController(new FloodRepository(files), new FloodService())
    await controller.getFloodAreas('2.5')
    await controller.getFloodAreas('2.5')
    expect(mockReadFile).toHaveBeenCalledTimes(1)
  })

  it('TTL 过期后重新读盘（Date.now spy）', async () => {
    const nowSpy = vi.spyOn(Date, 'now')
    let t = 1_700_000_000_000
    nowSpy.mockImplementation(() => t)
    try {
      const mockReadFile = vi.fn().mockResolvedValue(MOCK_FLOOD_AREA)
      const files = new DataFilesService(mockReadFile as unknown as typeof DEFAULT_READ_FILE)
      const controller = new FloodController(new FloodRepository(files), new FloodService())
      await controller.getFloodAreas('2.5')
      expect(mockReadFile).toHaveBeenCalledTimes(1)
      t += 6 * 60 * 1000
      await controller.getFloodAreas('2.5')
      expect(mockReadFile).toHaveBeenCalledTimes(2)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('超过上限（20）淘汰最旧条目，保留最新', async () => {
    const mockReadFile = vi
      .fn()
      .mockImplementation((p: string) => Promise.resolve(JSON.stringify({ f: String(p) })))
    const files = new DataFilesService(mockReadFile as unknown as typeof DEFAULT_READ_FILE)
    for (let i = 0; i < 25; i++) {
      await files.read(`file${i}.json`)
    }
    // 最旧 file0 已被淘汰 → 再读触发读盘；最新 file24 仍在缓存 → 不再读盘
    const callsAfterFill = mockReadFile.mock.calls.length
    await files.read('file0.json')
    expect(mockReadFile.mock.calls.length).toBe(callsAfterFill + 1)
    await files.read('file24.json')
    expect(mockReadFile.mock.calls.length).toBe(callsAfterFill + 1)
  })
})

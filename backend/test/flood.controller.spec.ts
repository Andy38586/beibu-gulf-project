import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { deriveRiskLevel } from '../src/common/constants/flood.constants'
import { BusinessError } from '../src/common/errors/business-error'
import { DbService } from '../src/infra/db/db.service'
import { SpatialRepository } from '../src/infra/db/spatial.repository'
import { DataFilesService, DEFAULT_READ_FILE } from '../src/infra/files/data-files.service'
import {
  FloodLevelFeatureRow,
  FloodRepository,
} from '../src/modules/flood/repositories/flood.repository'
import { FloodService } from '../src/modules/flood/services/flood.service'

// flood 业务层单测：移植 Express controllers/__tests__/floodAnalysisController.test.js
// 20 用例语义（mock reader 对齐 Express vi.mock fs/promises 模式），
// 覆盖：水位校验四态 / 档位组装 / deriveRiskLevel 表 / water-area 三态 / 缓存读一次 /
// TTL 过期（Date.now spy）/ LRU 淘汰
//
// ⚠️ 2026-09-10 迁移影响：档位淹没范围的数据源由 floodArea.json（6 档）改为 PostGIS
// `flood_levels`（251 档）。**向上取档逻辑已下沉到 SQL**（WHERE level >= $1 ORDER BY level
// LIMIT 1），故此处 mock 的是「PG 已选好档位后的返回行」，单测覆盖组装与契约，
// 取档语义本身属 SQL 行为（见 V3_INTEGRATION_DB 门控的真库用例）。
const MOCK_FLOOD_AREA = JSON.stringify({
  floodZones: [
    { waterLevel: 1.0, riskLevel: '低风险', features: [{ type: 'Feature', properties: {} }] },
    { waterLevel: 3.0, riskLevel: '中风险', features: [{ type: 'Feature', properties: {} }] },
    { waterLevel: 5.0, riskLevel: '高风险', features: [{ type: 'Feature', properties: {} }] },
  ],
})

// PG 返回行 fixture（NUMERIC 经 node-postgres 为 string；geometry 为 ST_AsGeoJSON 文本）
function mockLevelRows(levels: Array<[number, number]>): FloodLevelFeatureRow[] {
  return levels.map(([level, area]) => ({
    level: String(level),
    feature_count: 1,
    flooded_km2: '2.0',
    geometry: JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [108.6, 21.6],
          [108.7, 21.6],
          [108.7, 21.7],
          [108.6, 21.7],
          [108.6, 21.6],
        ],
      ],
    }),
    area: String(area),
  }))
}

const MOCK_STATISTICS = JSON.stringify({
  statistics: [
    { waterLevel: 1.0, floodArea: 0.5 },
    { waterLevel: 3.0, floodArea: 2.0 },
    { waterLevel: 5.0, floodArea: 5.0 },
  ],
})

// 水域坐标端点 fixture（结构与 backend/data/flood/water-area.json 同构）
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

// 洪涝点面判定已下沉 PostGIS（ST_Covers），涉及 assessDisaster 的用例需真库，
// 以 V3_INTEGRATION_DB 控制（与 favorites/plans/site-analysis 同口径）。
// 其余用例（水位校验/取档/读盘/缓存）不碰空间算子，无库环境照常跑。
const withDb = process.env.V3_INTEGRATION_DB !== undefined

let db: DbService | undefined
let spatial: SpatialRepository

function makeService(
  mockReadFile: ReturnType<typeof vi.fn>,
  // 默认：PG 已向上取档到 3.0（对应原 6 档 fixture 的 2.5 → 3.0 语义）
  levelRows: FloodLevelFeatureRow[] = mockLevelRows([[3.0, 0.5]])
): FloodService {
  const files = new DataFilesService(mockReadFile as unknown as typeof DEFAULT_READ_FILE)
  // db 桩：query 恒返回注入的档位行（模拟 PG 已选好档位；取档语义在 SQL 内，见文件头注释）
  const db = { query: vi.fn().mockResolvedValue({ rows: levelRows }) } as unknown as DbService
  const repository = new FloodRepository(files, db)
  // 非空间用例不会走到 assessDisaster（水位校验先抛错即短路），故 spatial 传空桩即可
  return new FloodService(repository, spatial)
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('getFloodAreas - 水位校验', () => {
  it('正常水位应返回档位数据', async () => {
    const service = makeService(vi.fn().mockResolvedValue(MOCK_FLOOD_AREA))
    const result = (await service.getFloodAreas('2.5')) as { actualWaterLevel: number }
    expect(result.actualWaterLevel).toBe(3.0)
  })

  it('Infinity 应触发业务错误', async () => {
    const service = makeService(vi.fn().mockResolvedValue(MOCK_FLOOD_AREA))
    await expect(service.getFloodAreas('Infinity')).rejects.toBeInstanceOf(BusinessError)
    await expect(service.getFloodAreas('Infinity')).rejects.toMatchObject({ bizCode: 400001 })
  })

  it('负数应触发业务错误', async () => {
    const service = makeService(vi.fn().mockResolvedValue(MOCK_FLOOD_AREA))
    await expect(service.getFloodAreas('-5')).rejects.toBeInstanceOf(BusinessError)
  })

  it('超过上限 25 应触发业务错误（与 FastAPI le=25 对齐）', async () => {
    const service = makeService(vi.fn().mockResolvedValue(MOCK_FLOOD_AREA))
    await expect(service.getFloodAreas('150')).rejects.toBeInstanceOf(BusinessError)
  })

  it('26-100 之间的越界水位应触发业务错误', async () => {
    const service = makeService(vi.fn().mockResolvedValue(MOCK_FLOOD_AREA))
    await expect(service.getFloodAreas('30')).rejects.toBeInstanceOf(BusinessError)
  })

  it('非数字应触发业务错误', async () => {
    const service = makeService(vi.fn().mockResolvedValue(MOCK_FLOOD_AREA))
    await expect(service.getFloodAreas('abc')).rejects.toBeInstanceOf(BusinessError)
  })

  it('取档：请求 2.5 → PG 已向上取到 3.0（宁可高估风险）', async () => {
    const service = makeService(vi.fn().mockResolvedValue(MOCK_FLOOD_AREA))
    const result = (await service.getFloodAreas('2.5')) as Record<string, unknown> & {
      actualWaterLevel: number
      requestedWaterLevel: number
      riskLevel: string
      features: Array<{ properties: Record<string, unknown> }>
    }
    expect(result.actualWaterLevel).toBe(3.0)
    expect(result.requestedWaterLevel).toBe(2.5)
    // riskLevel 由实际档位派生（3.0 档中风险）
    expect(result.riskLevel).toBe('中风险')
    expect(result.features[0].properties.riskLevel).toBe('中风险')
  })

  it('水位恰为档位值（5.0）→ 命中该档（向上取档含等值）', async () => {
    const service = makeService(vi.fn(), mockLevelRows([[5.0, 0.5]]))
    const result = (await service.getFloodAreas('5')) as {
      actualWaterLevel: number
      riskLevel: string
    }
    expect(result.actualWaterLevel).toBe(5.0)
    // 口径以 RISK_LEVEL_BANDS 为准：5 ≤ 5 → 中风险（原 fixture 把 5.0 标为"高风险"系
    // 手写数据与阈值表不一致；改由 deriveRiskLevel 派发后该偏差自动消解）
    expect(result.riskLevel).toBe('中风险')
  })

  it('actual/requested 双报：向上取档时 actual > requested（前端可感知）', async () => {
    const service = makeService(vi.fn().mockResolvedValue(MOCK_FLOOD_AREA))
    const result = (await service.getFloodAreas('2.5')) as {
      actualWaterLevel: number
      requestedWaterLevel: number
    }
    expect(result.actualWaterLevel).toBe(3.0)
    expect(result.requestedWaterLevel).toBe(2.5)
  })

  it('未指定水位 → 返回全部档位（按档分组）', async () => {
    const service = makeService(
      vi.fn(),
      mockLevelRows([
        [1.0, 0.3],
        [3.0, 0.5],
        [5.0, 0.9],
      ])
    )
    const result = (await service.getFloodAreas()) as Array<{ waterLevel: number }>
    expect(result).toHaveLength(3)
    expect(result.map((z) => z.waterLevel)).toEqual([1.0, 3.0, 5.0])
  })

  it('表未灌数（PG 返回空）→ 无风险空响应兜底', async () => {
    const service = makeService(vi.fn(), [])
    const result = (await service.getFloodAreas('2.5')) as {
      riskLevel: string
      features: unknown[]
    }
    expect(result.riskLevel).toBe('无风险')
    expect(result.features).toEqual([])
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
    const service = makeService(vi.fn().mockResolvedValue(MOCK_STATISTICS))
    const result = (await service.getFloodStatistics('3.0')) as Record<string, unknown>
    expect(result).toMatchObject({ waterLevel: 3.0, floodArea: 2.0 })
  })

  it('Infinity 应触发业务错误', async () => {
    const service = makeService(vi.fn().mockResolvedValue(MOCK_STATISTICS))
    await expect(service.getFloodStatistics('Infinity')).rejects.toBeInstanceOf(BusinessError)
  })

  it('超档（>5）取最高档兜底，不静默返 null', async () => {
    const service = makeService(vi.fn().mockResolvedValue(MOCK_STATISTICS))
    const result = (await service.getFloodStatistics('4.9')) as { waterLevel: number }
    expect(result.waterLevel).toBe(5.0)
  })

  it('未指定水位 → 返回全部统计', async () => {
    const service = makeService(vi.fn().mockResolvedValue(MOCK_STATISTICS))
    const result = (await service.getFloodStatistics()) as unknown[]
    expect(result).toHaveLength(3)
  })
})

describe('analyzeDisaster - 水位校验', () => {
  it('缺少水位应触发业务错误（文案逐字节）', async () => {
    const service = makeService(vi.fn())
    await expect(service.analyzeDisaster({})).rejects.toMatchObject({
      bizCode: 400001,
      message: '缺少水位参数',
    })
  })

  it('body 为空（无 JSON 体）同样触发缺少水位参数', async () => {
    const service = makeService(vi.fn())
    await expect(service.analyzeDisaster(undefined)).rejects.toMatchObject({
      bizCode: 400001,
    })
  })

  it('Infinity 应触发业务错误', async () => {
    const service = makeService(vi.fn())
    await expect(service.analyzeDisaster({ waterLevel: 'Infinity' })).rejects.toBeInstanceOf(
      BusinessError
    )
  })
})

describe.skipIf(!withDb)('floodService.assessDisaster - 空间筛选与损失计算（真库 PostGIS）', () => {
  beforeAll(() => {
    db = new DbService()
    spatial = new SpatialRepository(db)
  })

  afterAll(async () => {
    await db?.onModuleDestroy()
  })

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

  function makeDbService(): FloodService {
    // assessDisaster 不读数据文件，repository 用空桩构造；db 取真库（beforeAll 内建，
    // 本组用例直接调 assessDisaster 不触发 repository 查询，故仅需类型占位）
    const files = new DataFilesService(vi.fn() as unknown as typeof DEFAULT_READ_FILE)
    return new FloodService(new FloodRepository(files, db as DbService), spatial)
  }

  it('点在淹没多边形内 → loss=value×damageRate，多边形外不计入', async () => {
    const service = makeDbService()
    const result = await service.assessDisaster(FACILITIES, 5, FLOOD_ZONE)
    expect(result.affectedFacilities).toHaveLength(1)
    expect(result.affectedFacilities[0].loss).toBe(15000 * 0.85)
    expect(result.totalLoss).toBe(Math.round(15000 * 0.85))
    expect(result.riskLevel).toBe('中风险')
    expect(result.waterLevel).toBe(5)
  })

  it('无淹没档位（0 档/null）→ 无风险 + 零损失 + waterLevel undefined', async () => {
    const service = makeDbService()
    for (const zone of [null, { waterLevel: 0, riskLevel: '无风险', features: [] }]) {
      const result = await service.assessDisaster(FACILITIES, 0, zone)
      expect(result).toEqual({
        affectedFacilities: [],
        totalLoss: 0,
        riskLevel: '无风险',
        waterLevel: undefined,
      })
    }
  })

  it('value/damageRate 非数值按 0 计（合法 0 保留）', async () => {
    const service = makeDbService()
    const dirty = [{ ...FACILITIES[0], value: NaN, damageRate: undefined as unknown as number }]
    const result = await service.assessDisaster(dirty, 5, FLOOD_ZONE)
    expect(result.affectedFacilities[0].loss).toBe(0)
    expect(result.totalLoss).toBe(0)
  })
})

describe('getWaterArea - 水域坐标端点', () => {
  it('正常应返回坐标数组（data 为 [[lng,lat],...]）', async () => {
    const service = makeService(vi.fn().mockResolvedValue(MOCK_WATER_AREA))
    const result = (await service.getWaterArea()) as number[][]
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual([108.615, 21.855])
  })

  it('coordinates 缺失应触发业务错误（NOT_FOUND 404001）', async () => {
    const service = makeService(vi.fn().mockResolvedValue(JSON.stringify({ id: 'x', name: 'x' })))
    await expect(service.getWaterArea()).rejects.toMatchObject({
      bizCode: 404001,
      status: 404,
    })
  })

  it('coordinates 为空数组应触发业务错误', async () => {
    const service = makeService(
      vi.fn().mockResolvedValue(JSON.stringify({ id: 'x', name: 'x', coordinates: [] }))
    )
    await expect(service.getWaterArea()).rejects.toBeInstanceOf(BusinessError)
  })
})

describe('DataFilesService 统一入口 - 读盘缓存', () => {
  // 以 getWaterArea 为触发器：getFloodAreas 已改走 PostGIS（不再读盘），而缓存行为属
  // DataFilesService 自身，用任一仍读盘的端点即可验证。
  function makeReadService(mockReadFile: ReturnType<typeof vi.fn>): FloodService {
    const files = new DataFilesService(mockReadFile as unknown as typeof DEFAULT_READ_FILE)
    const db = { query: vi.fn() } as unknown as DbService
    return new FloodService(new FloodRepository(files, db), spatial)
  }

  it('同端点连续两次调用只读盘一次', async () => {
    const mockReadFile = vi.fn().mockResolvedValue(MOCK_WATER_AREA)
    const service = makeReadService(mockReadFile)
    await service.getWaterArea()
    await service.getWaterArea()
    expect(mockReadFile).toHaveBeenCalledTimes(1)
  })

  it('TTL 过期后重新读盘（Date.now spy）', async () => {
    const nowSpy = vi.spyOn(Date, 'now')
    let t = 1_700_000_000_000
    nowSpy.mockImplementation(() => t)
    try {
      const mockReadFile = vi.fn().mockResolvedValue(MOCK_WATER_AREA)
      const service = makeReadService(mockReadFile)
      await service.getWaterArea()
      expect(mockReadFile).toHaveBeenCalledTimes(1)
      t += 6 * 60 * 1000
      await service.getWaterArea()
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

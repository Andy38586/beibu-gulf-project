import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { deriveRiskLevel, deriveRiskLevelCode } from '../src/common/constants/flood.constants'
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
function mockLevelRows(
  levels: Array<[number, number]>,
  floodedKm2 = '2.0'
): FloodLevelFeatureRow[] {
  return levels.map(([level, area]) => ({
    level: String(level),
    feature_count: 1,
    flooded_km2: floodedKm2,
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

// 6 档 DEM 反演参考表 fixture（仅水深参考字段在本轮改造后仍被消费）
const MOCK_STATISTICS = JSON.stringify({
  statistics: [
    { waterLevel: 1.0, floodArea: 0.5, averageDepth: 0.1, maxDepth: 0.2 },
    { waterLevel: 3.0, floodArea: 2.0, averageDepth: 0.8, maxDepth: 1.1 },
    { waterLevel: 5.0, floodArea: 5.0, averageDepth: 2.04, maxDepth: 2.5 },
  ],
})

// 垂直基准偏移 fixture：与 backend/data/flood/terrainProfile.json 的 metadata.datumOffset 同值
//（水位=理论深度基准面 → EGM96 正高，生成脚本按 waterLevel.json 的 baseLevels.msl 写入）
const MOCK_TERRAIN_PROFILE = JSON.stringify({
  metadata: { datumOffset: 2.5 },
  profiles: [],
})

// 设施点 fixture（结构与 backend/data/flood/facilityPoints.json 同构）。
// elevation 语义（P1.5 高程门控，2026-09-12）：被淹设施高程须 ≤ 档位值（mask 的 dem ≤ level
// 同口径）；原 12.0m 设施在 5m 档被计淹属假阳性语义，fixture 修正为低洼码头
const MOCK_FACILITY_RAW = {
  id: 'QZ-001',
  name: '三墩港口',
  type: '港口码头',
  port: '钦州港',
  lng: 108.697,
  lat: 21.61,
  elevation: 2.0,
  value: 15000,
  damageRate: 0.85,
}

const MOCK_FACILITY_POINTS = JSON.stringify({
  facilities: [
    MOCK_FACILITY_RAW,
    {
      id: 'FCG-001',
      name: '防城港码头',
      type: '港口码头',
      port: '防城港',
      lng: 108.35,
      lat: 21.68,
      elevation: 2.5,
      value: 20000,
      damageRate: 0.5,
    },
  ],
})

// 点面判定桩：统计/灾害评估命中索引由用例注入（真库行为见 V3_INTEGRATION_DB 门控用例）
function stubSpatial(hitIndices: number[]): SpatialRepository {
  return {
    pointIndicesInAnyPolygon: vi.fn().mockResolvedValue(hitIndices),
  } as unknown as SpatialRepository
}

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

const MOCK_FACILITY = MOCK_FACILITY_RAW

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
    // 口径以 RISK_LEVEL_BANDS 为准：水文锚定重划（2026-09-12）后 5.0 落 高风险带
    //（+4.3 极端最高 ~ +6.0）
    expect(result.riskLevel).toBe('高风险')
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
  it('语义对齐风险分级（0/2/4.3/6/8/∞，海平面基准水文锚定重划）', () => {
    expect(deriveRiskLevel(0)).toBe('无风险')
    expect(deriveRiskLevel(2)).toBe('低风险')
    expect(deriveRiskLevel(4.3)).toBe('中风险')
    expect(deriveRiskLevel(6)).toBe('高风险')
    expect(deriveRiskLevel(8)).toBe('极高风险')
    expect(deriveRiskLevel(12.5)).toBe('灾难级')
    // 边界抽检：3.5（设计高潮位与极端最高之间）→ 中风险；4.3 恰为档位值含等值
    expect(deriveRiskLevel(3.5)).toBe('中风险')
    expect(deriveRiskLevel(2.1)).toBe('中风险')
    expect(deriveRiskLevel(1.9)).toBe('低风险')
  })

  it('riskLevelCode 与 RISK_LEVEL_BANDS 下标同源（沿用 floodStatistics.json 编码口径）', () => {
    expect(deriveRiskLevelCode(0)).toBe(0)
    expect(deriveRiskLevelCode(2)).toBe(1)
    expect(deriveRiskLevelCode(4.3)).toBe(2)
    expect(deriveRiskLevelCode(6)).toBe(3)
    expect(deriveRiskLevelCode(8)).toBe(4)
    expect(deriveRiskLevelCode(12.5)).toBe(5)
    expect(deriveRiskLevelCode(25)).toBe(5)
  })
})

describe('getFloodStatistics - 与 flood-areas/disaster 同源（251 档 + 空间判定）', () => {
  /** mock reader：按路径分发参考表 / 设施点 / 剖面（DataFilesService 缓存按实例隔离） */
  function makeStatisticsReadFile(
    facilityPoints: string = MOCK_FACILITY_POINTS
  ): ReturnType<typeof vi.fn> {
    return vi.fn().mockImplementation((p: string) => {
      if (p.includes('facilityPoints')) return Promise.resolve(facilityPoints)
      // 基准偏移来自地形剖面文件（单一来源）：披露判据靠它换算参考档的 EGM96 等值，
      // 缺了它会退化成"上下同基准"⇒ 披露消失（W19）
      if (p.includes('terrainProfile')) return Promise.resolve(MOCK_TERRAIN_PROFILE)
      return Promise.resolve(MOCK_STATISTICS)
    })
  }

  function makeStatisticsService(
    levelRows: FloodLevelFeatureRow[],
    hitIndices: number[],
    facilityPoints?: string
  ): FloodService {
    const files = new DataFilesService(
      makeStatisticsReadFile(facilityPoints) as unknown as typeof DEFAULT_READ_FILE
    )
    const db = { query: vi.fn().mockResolvedValue({ rows: levelRows }) } as unknown as DbService
    return new FloodService(new FloodRepository(files, db), stubSpatial(hitIndices))
  }

  it('档位与面积取 PG 实际档（4.5 → 4.5，不再粗化到 6 档参考表的 5）', async () => {
    const service = makeStatisticsService(mockLevelRows([[4.5, 0.5]], '777.7'), [])
    const result = (await service.getFloodStatistics('4.5')) as Record<string, unknown>
    expect(result).toMatchObject({
      waterLevel: 4.5,
      requestedWaterLevel: 4.5,
      actualWaterLevel: 4.5,
      floodArea: 777.7,
      // 水文锚定重划：4.5 已超极端最高 +4.3 → 高风险带
      riskLevel: '高风险',
      riskLevelCode: 3,
    })
  })

  it('水深为 6 档参考表值并由 depthRefLevel 标注所属档位（4.5 → 5 档）', async () => {
    const service = makeStatisticsService(mockLevelRows([[4.5, 0.5]], '777.7'), [])
    const result = (await service.getFloodStatistics('4.5')) as Record<string, unknown>
    // 参考表 3.0/5.0 两档 → 向上命中 5.0；水深为 5 档 DEM 反演值，非当前水位精确值
    expect(result).toMatchObject({ depthRefLevel: 5, averageDepth: 2.04, maxDepth: 2.5 })
    // 披露含基准与低估量（W19）：5 档反演基准 = EGM96 5 − 2.5 = 2.5，实际档位 4.5 ⇒ 低 2m
    expect(result).toMatchObject({ depthUnderstatedBy: 2 })
    expect(String(result.description)).toContain('5m 档 DEM 反演参考值')
    expect(String(result.description)).toContain('对应 EGM96 2.5m，比实际档位低 2m')
  })

  it('水位恰为参考档位时仍按 EGM96 基准披露（W19：参考档基准比档位值低 2.5m）', async () => {
    const service = makeStatisticsService(mockLevelRows([[5.0, 0.9]], '576.91'), [])
    const result = (await service.getFloodStatistics('5')) as Record<string, unknown>
    expect(result).toMatchObject({
      waterLevel: 5,
      depthRefLevel: 5,
      averageDepth: 2.04,
      depthUnderstatedBy: 2.5,
    })
    expect(String(result.description)).toContain('对应 EGM96 2.5m，比实际档位低 2.5m')
  })

  it('设施数/受影响港口/损失与 disaster 同一次点面判定（count/ports/totalLoss）', async () => {
    const service = makeStatisticsService(mockLevelRows([[5.0, 0.9]], '576.91'), [0, 1])
    const result = (await service.getFloodStatistics('5')) as Record<string, unknown>
    expect(result.affectedFacilityCount).toBe(2)
    expect(result.affectedPorts).toEqual(['钦州港', '防城港'])
    // 损失含水深因子（X4，与生成侧 flood_realify.py 同式）：
    //   QZ-001 高程 2.0 ⇒ d=5−2=3 ⇒ 因子 1.0  ⇒ 15000×0.85×1.0 = 12750
    //   FCG-001 高程 2.5 ⇒ d=5−2.5=2.5 ⇒ 因子 2.5/3 ⇒ 20000×0.5×0.8333… = 8333.33
    // 合计 21083.33 → Math.round ⇒ 21083（旧形态无因子时为 22750）
    expect(result.estimatedLoss).toBe(21083)
  })

  it('🔴 高程为 null 的设施按未淹计（深度 0 ⇒ 损失 0），与生成侧 NoData 同口径', async () => {
    // 生成侧对 DEM NoData 点写的是 null（flood_realify.py:152 `if ok else None`），
    // facility_depths（:193-200）对无高程一律记 0.0 ⇒ 损失因子 0。
    // 运行侧旧写法 `Number(facility.elevation)`：Number(null)=0 ⇒ 当成「海拔 0 米」
    // ⇒ 深度满淹、因子 1 ⇒ 全额损失，与生成侧差一个满淹水位（本用例即钉住这个分歧）。
    const facilities = JSON.parse(MOCK_FACILITY_POINTS) as {
      facilities: Array<Record<string, unknown>>
    }
    facilities.facilities[1].elevation = null
    const service = makeStatisticsService(
      mockLevelRows([[5.0, 0.9]], '576.91'),
      [0, 1],
      JSON.stringify(facilities)
    )
    const result = (await service.getFloodStatistics('5')) as Record<string, unknown>

    // QZ-001 高程 2.0 ⇒ d=3 ⇒ 因子 1 ⇒ 12750；FCG-001 无高程 ⇒ 0 ⇒ 合计 12750
    expect(result.estimatedLoss).toBe(12750)
    // 受影响数按点面判定（不依赖高程），两个设施都算
    expect(result.affectedFacilityCount).toBe(2)
    expect(result.affectedPorts).toEqual(['钦州港', '防城港'])
  })

  it('无命中设施 → 计数/港口/损失归零，档位信息仍返回', async () => {
    const service = makeStatisticsService(mockLevelRows([[3.0, 0.5]], '100.0'), [])
    const result = (await service.getFloodStatistics('3')) as Record<string, unknown>
    expect(result).toMatchObject({
      waterLevel: 3,
      affectedFacilityCount: 0,
      affectedPorts: [],
      estimatedLoss: 0,
    })
  })

  it('Infinity 应触发业务错误', async () => {
    const service = makeStatisticsService(mockLevelRows([[3.0, 0.5]]), [])
    await expect(service.getFloodStatistics('Infinity')).rejects.toBeInstanceOf(BusinessError)
  })

  it('未指定水位 → 返回 6 档参考表原样（兼容契约，仅水深参考字段有效）', async () => {
    const service = makeStatisticsService(mockLevelRows([[3.0, 0.5]]), [])
    const result = (await service.getFloodStatistics()) as unknown[]
    expect(result).toHaveLength(3)
  })

  it('PG 空表（未灌数防御）→ 零值响应，不静默返 null', async () => {
    const service = makeStatisticsService([], [])
    const result = (await service.getFloodStatistics('5')) as Record<string, unknown>
    expect(result).toMatchObject({
      waterLevel: 5,
      riskLevel: '无风险',
      floodArea: 0,
      affectedFacilityCount: 0,
      estimatedLoss: 0,
    })
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

  it('点在淹没多边形内 → loss=value×damageRate×min(d/3,1)，多边形外不计入', async () => {
    const service = makeDbService()
    const result = await service.assessDisaster(FACILITIES, 5, FLOOD_ZONE)
    expect(result.affectedFacilities).toHaveLength(1)
    // 高程 2.0、档位 5.0 ⇒ d=3 ⇒ 因子 1（饱和，与旧形态同值）；折减见下一条
    expect(result.affectedFacilities[0].loss).toBe(15000 * 0.85)
    expect(result.totalLoss).toBe(Math.round(15000 * 0.85))
    expect(result.riskLevel).toBe('中风险')
    expect(result.waterLevel).toBe(5)
  })

  it('🔴 水深未饱和按 min(d/3,1) 折减（X4：与生成侧同式；关掉因子此值即变）', async () => {
    const service = makeDbService()
    // 高程 3.5、档位 5.0 ⇒ d=1.5 ⇒ 因子 0.5 ⇒ 损失减半（旧形态为全值 12750）
    const shallow = { ...MOCK_FACILITY, elevation: 3.5 }
    const result = await service.assessDisaster([shallow], 5, FLOOD_ZONE)
    expect(result.affectedFacilities[0].loss).toBeCloseTo(15000 * 0.85 * 0.5, 6)
    expect(result.totalLoss).toBe(Math.round(15000 * 0.85 * 0.5))
    // 高程缺失 ⇒ d=0 ⇒ 因子 0（与生成侧 facility_depths 同口径：无高程视为未淹、不计损失）
    const noElevation = { ...MOCK_FACILITY, elevation: undefined as unknown as number }
    const result2 = await service.assessDisaster([noElevation], 5, FLOOD_ZONE)
    expect(result2.totalLoss).toBe(0)
  })

  it('多边形内但设施高程高于水位 → 高程门控不计入（P1.5 假阳性防护）', async () => {
    // 淹没几何含 300m 简化容差，沿岸高地会被外扩多边形吞进点面判定——
    // 高程 12m 的设施在 5m 档不得计淹（与 mask 的 dem ≤ level 语义对齐）
    const service = makeDbService()
    const elevated = { ...MOCK_FACILITY, elevation: 12 }
    const result = await service.assessDisaster([elevated], 5, FLOOD_ZONE)
    expect(result.affectedFacilities).toHaveLength(0)
    expect(result.totalLoss).toBe(0)
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

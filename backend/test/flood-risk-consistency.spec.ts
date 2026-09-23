/**
 * 风险等级口径一致性（问题 d057）：
 *
 * 背景：floodStatistics.json 里给六档各预置了 `riskLevel` / `riskLevelCode`，它们与权威
 * 分段表（RISK_LEVEL_BANDS → deriveRiskLevel / deriveRiskLevelCode）不同步：实测 5m 写
 * 「中风险/code 2」而权威是「高风险/code 3」，8m/10m 各错一档，15m 标签对而码写成 2。
 * 两处行数(src+=px)。风险一旦各按各的口径出，GET /flood-statistics 的 riskLevel 与
 * riskLevelCode 会给出互斥判断。
 *
 * 修两条：① 运行侧只按水段派生，表中那两个字段彻底不消费；② 表里现存值订正到与权威一致，
 * 并由本单测持续对账（将来哪一侧再漂都能红）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, describe, it, vi } from 'vitest'

import { deriveRiskLevel, deriveRiskLevelCode } from '../src/common/constants/flood.constants'
import { SpatialRepository } from '../src/infra/db/spatial.repository'
import { DEFAULT_READ_FILE, DataFilesService } from '../src/infra/files/data-files.service'
import { FloodRepository } from '../src/modules/flood/repositories/flood.repository'
import { FloodService } from '../src/modules/flood/services/flood.service'

const STATISTICS_PATH = join(__dirname, '../data/flood/floodStatistics.json')

interface Row {
  waterLevel: number
  riskLevel: string
  riskLevelCode: number
}

const rows: Row[] = JSON.parse(readFileSync(STATISTICS_PATH, 'utf8')).statistics

describe('六档参考表的预置标签 ≡ 权威分段判定（d057）', () => {
  it('表覆盖六档', () => {
    expect(rows.map((r) => r.waterLevel)).toEqual([0, 2, 5, 8, 10, 15])
  })

  it('🔴 每档的 riskLevel 都等于 deriveRiskLevel(该档水位)', () => {
    for (const row of rows) {
      expect(
        row.riskLevel,
        `${row.waterLevel}m 表内标签「${row.riskLevel}」≠ 权威「${deriveRiskLevel(row.waterLevel)}」`
      ).toBe(deriveRiskLevel(row.waterLevel))
    }
  })

  it('🔴 每档的 riskLevelCode 都等于 deriveRiskLevelCode(该档水位)', () => {
    for (const row of rows) {
      expect(
        row.riskLevelCode,
        `${row.waterLevel}m 表内码 ${row.riskLevelCode} ≠ 权威 ${deriveRiskLevelCode(row.waterLevel)}`
      ).toBe(deriveRiskLevelCode(row.waterLevel))
    }
  })

  it('🔴 标签与码互不自相矛盾（同一档必须指向同一档 Code）', () => {
    const asList = deriveRiskLevelBand()
    for (const row of rows) {
      expect(
        asList.indexOf(row.riskLevel),
        `${row.waterLevel}m：标签「${row.riskLevel}」与码 ${row.riskLevelCode} 不是同一档`
      ).toBe(row.riskLevelCode)
    }
  })
})

/** 分段表标签的顺序索引（= riskLevelCode 的权威口径） */
function deriveRiskLevelBand(): string[] {
  return [0, 2, 4.3, 6, 8, 15].map((lv) => deriveRiskLevel(lv))
}

describe('运行侧不再消费表中的预置标签（d057 的治本侧）', () => {
  function makeService(): FloodService {
    // assessDisaster 不读数据文件；空间判定打桩返回全部命中 ⇒ 本地可跑（不需要 PG）
    const files = new DataFilesService(vi.fn() as unknown as typeof DEFAULT_READ_FILE)
    const spatial = {
      pointIndicesInAnyPolygon: vi.fn().mockResolvedValue([0]),
    } as unknown as SpatialRepository
    return new FloodService(new FloodRepository(files, vi.fn() as never), spatial)
  }

  // 一个高程足够的设施（保证点面判定命中、走正常派生分支而非零值早退分支）
  const FACILITY = {
    id: 'P-1',
    name: '测试设施',
    type: '港口码头',
    port: '钦州港',
    lng: 108.5,
    lat: 21.6,
    elevation: 1.0,
    value: 1000,
    damageRate: 0.5,
    extra: {},
  } as never

  // 非空的淹没多边形：空 features 会让 assessDisaster 走"无淹没多边形"早退分支
  //（返回 riskLevel=无风险），那样就测不到档位派生了
  const FLOOD_ZONE_WITH_FEATURE = (waterLevel: number, riskLevel: string) =>
    ({
      waterLevel,
      riskLevel,
      features: [
        {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'Polygon' as const,
            coordinates: [[[108, 21], [109, 21], [109, 22], [108, 22], [108, 21]]],
          },
        },
      ],
    }) as never

  it('🔴 传入带预置标签的档位对象时，riskLevel 仍按水段派生（入参标签不被回显）', async () => {
    const service = makeService()
    // 表的 5m 历史上写「中风险/code 2」——即便调用方照原样传进来也不得回显
    const result = await service.assessDisaster(
      [FACILITY],
      5,
      FLOOD_ZONE_WITH_FEATURE(5, '中风险')
    )
    expect(result.riskLevel).toBe(deriveRiskLevel(5)) // 高风险
    expect(result.riskLevel).not.toBe('中风险')
  })

  it('🔴 标签说谎也拦得住：写「无风险」的 15m 档仍得「灾难级」', async () => {
    const service = makeService()
    const result = await service.assessDisaster(
      [FACILITY],
      15,
      FLOOD_ZONE_WITH_FEATURE(15, '无风险')
    )
    expect(result.riskLevel).toBe('灾难级')
  })
})

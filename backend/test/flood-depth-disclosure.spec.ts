import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  FloodLevelFeatureRow,
  FloodRepository,
} from '../src/modules/flood/repositories/flood.repository'
import { FloodService } from '../src/modules/flood/services/flood.service'

// W19（d056 N-1）判据回归：**六档真值表的「披露」列必须与实际低估量一致**。
//
// 背景：floodStatistics.json 的 averageDepth/maxDepth 由 flood_realify.py 按
// 「EGM96 正高 = 档位水位 − datumOffset」反演，而响应里的 actualLevel 是 PostGIS 档位值
//（同为 EGM96）。旧实现拿档位标签（理论深度基准面）直接与 actualLevel 比 ⇒ 基准混用 ⇒
// 披露反转：真低估 2.5m 的档（2/5/8/10/15m）全不披露，唯一不低估的档（请求 2.5m）反而披露。
//
// 本件用**真数据文件 + 打桩 repository**（不连库、不起服务）跑真实 getFloodStatistics，
// 逐档断言「披露 ⇔ 低估 > 0」并钉住披露出量值。判据随源码走（不手写镜像）。
const FLOOD_DIR = path.resolve(process.cwd(), 'data', 'flood')

const statsFile = JSON.parse(
  readFileSync(path.join(FLOOD_DIR, 'floodStatistics.json'), 'utf8')
) as { statistics: Array<{ waterLevel: number; averageDepth?: number; maxDepth?: number }> }
const terrainFile = JSON.parse(
  readFileSync(path.join(FLOOD_DIR, 'terrainProfile.json'), 'utf8')
) as {
  metadata?: { datumOffset?: number }
}

/** 真值表覆盖的请求水位：六档 + 2.5（唯一不低估的档，旧形态在此处恰恰会披露） */
const LEVELS = [0, 2, 2.5, 5, 8, 10, 15] as const

/** PG 取档语义（0.1m 步长向上取档）：与 flood_levels 真值网格逐档一致（探针已比对） */
function gridLevel(request: number): number {
  return Math.ceil(request * 10) / 10
}

function buildService(): FloodService {
  const repository = {
    readFloodStatistics: async () => statsFile,
    readTerrainProfile: async () => terrainFile,
    readFacilityPoints: async () => ({ facilities: [] }),
    // 档位存在但无几何（0 档语义）：assessDisaster 走「无淹没多边形」分支
    pickFloodLevel: async (level: number): Promise<FloodLevelFeatureRow[]> => [
      {
        level: String(gridLevel(level)),
        feature_count: 0,
        flooded_km2: '0',
        geometry: null,
        area: '0',
      },
    ],
  } as unknown as FloodRepository
  const spatial = { pointIndicesInAnyPolygon: async () => [] }
  return new FloodService(repository, spatial as never)
}

interface TruthRow {
  level: number
  actualLevel: number
  depthRefLevel: number
  understatedBy: number
  disclosed: boolean
  description: string
}

async function truthTable(): Promise<TruthRow[]> {
  const service = buildService()
  const rows: TruthRow[] = []
  for (const level of LEVELS) {
    const res = (await service.getFloodStatistics(String(level))) as {
      actualWaterLevel: number
      depthRefLevel: number
      depthUnderstatedBy: number
      description: string
    }
    rows.push({
      level,
      actualLevel: res.actualWaterLevel,
      depthRefLevel: res.depthRefLevel,
      understatedBy: res.depthUnderstatedBy,
      // 披露 = description 里出现"档 DEM 反演参考值"这句（与 depthNote 同一处拼接）
      disclosed: res.description.includes('DEM 反演参考值'),
      description: res.description,
    })
  }
  return rows
}

describe('W19 flood-statistics 水深参考档披露', () => {
  it('🔴 披露列与实际低估量一致：低估 > 0 才披露，且披露出量值', async () => {
    const rows = await truthTable()
    // 真值表落盘（提交体取证用；-v 时可见）
    console.log(
      [
        '请求 | 实际档 | 参考档 | 低估 | 披露',
        ...rows.map(
          (r) =>
            `${String(r.level).padStart(4)} | ${String(r.actualLevel).padStart(6)} | ${String(
              r.depthRefLevel
            ).padStart(6)} | ${String(r.understatedBy).padStart(4)} | ${r.disclosed ? '有' : '无'}`
        ),
      ].join('\n')
    )

    for (const row of rows) {
      // 判据本体：有低估 ⇔ 有披露（旧形态在 2/5/8/10/15m 上为「低估 2.5m 却不披露」⇒ 红）
      expect(row.disclosed).toBe(row.understatedBy > 0)
      if (row.understatedBy > 0) {
        // 披露出量值：与真值表"实际低估"列同数
        expect(row.description).toContain(`比实际档位低 ${row.understatedBy}m`)
      }
    }

    // 钉住六档真值：披露集合 = 除 2.5m 外全部（2.5m 恰好落在参考档 EGM96 等值上，低估 0）
    expect(rows.filter((r) => r.disclosed).map((r) => r.level)).toEqual([0, 2, 5, 8, 10, 15])
    // 低估量与"档位标签 − EGM96 等值"逐一对应（datumOffset=2.5）
    for (const row of rows) {
      const ref = statsFile.statistics.find((s) => s.waterLevel === row.depthRefLevel)
      expect(ref).toBeDefined()
      const basis = (row.depthRefLevel ?? 0) - (terrainFile.metadata?.datumOffset ?? 0)
      expect(row.understatedBy).toBe(Math.max(0, Number((row.actualLevel - basis).toFixed(1))))
    }
  })

  it('参考档位与实际档位相同时（2.5m），不披露', async () => {
    const rows = await truthTable()
    const row = rows.find((r) => r.level === 2.5)
    expect(row?.depthRefLevel).toBe(5) // 标签仍是 5m 档
    expect(row?.understatedBy).toBe(0) // 但该档 EGM96 等值 = 2.5 = 实际档位
    expect(row?.disclosed).toBe(false)
  })
})

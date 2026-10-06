import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DbService } from '../src/infra/db/db.service'
import { GeoJsonGeometry, SpatialRepository } from '../src/infra/db/spatial.repository'

// 空间算子真库套件：需 beibu-gulf-data + PostGIS（docker-compose.v3.yml）。无库环境整体跳过，
// 避免 ECONNREFUSED 噪音；联调时 export V3_INTEGRATION_DB=1 恢复全量（与 favorites/plans 同口径）。
//
// 定位：turf→PostGIS 下沉后的**空间正确性守门人**（2026-09-12 起 turf 全面退场）。
// 现行验收锚点全部为**解析几何不变量**，不依赖任何第二实现：
//   ① 点面判定（多边形集合）：命中任一即计入、空列表无命中
//   ② SRID 混用守门（4490 库几何 × 4326 入参点）
const withDb = process.env.V3_INTEGRATION_DB !== undefined

let db: DbService | undefined
let spatial: SpatialRepository

// 以 (108.6, 21.85) 为中心、边长约 2km 的方形
const SQUARE: GeoJsonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [108.59, 21.84],
      [108.61, 21.84],
      [108.61, 21.86],
      [108.59, 21.86],
      [108.59, 21.84],
    ],
  ],
}

describe.skipIf(!withDb)('SpatialRepository（真库 / PostGIS）', () => {
  beforeAll(() => {
    db = new DbService()
    spatial = new SpatialRepository(db)
  })

  afterAll(async () => {
    await db?.onModuleDestroy()
  })

  describe('pointIndicesInAnyPolygon — 命中任一即计入', () => {
    const boxA: GeoJsonGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [108.5, 21.8],
          [108.55, 21.8],
          [108.55, 21.85],
          [108.5, 21.85],
          [108.5, 21.8],
        ],
      ],
    }
    const boxB: GeoJsonGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [108.7, 21.9],
          [108.75, 21.9],
          [108.75, 21.95],
          [108.7, 21.95],
          [108.7, 21.9],
        ],
      ],
    }
    const points = [
      { lng: 108.52, lat: 21.82 }, // 0 in A
      { lng: 108.72, lat: 21.92 }, // 1 in B
      { lng: 108.6, lat: 21.87 }, // 2 两者之外
      { lng: 108.54, lat: 21.84 }, // 3 in A
    ]

    it('命中任一多边形即计入（已知解析解）', async () => {
      const hit = await spatial.pointIndicesInAnyPolygon(points, [boxA, boxB])
      expect(hit).toEqual([0, 1, 3])
    })

    it('多边形列表为空 → 无命中（不等价于"全部命中"）', async () => {
      expect(await spatial.pointIndicesInAnyPolygon(points, [])).toEqual([])
    })
  })

  // 回归守门：线上 2026-09-11 查出「浸没设施恒 0」的根因，正是本用例覆盖的场景——
  // flood_levels 为 4490(CGCS2000) 表，repository 若漏 ST_Transform 直接 ST_AsGeoJSON 取出，
  // 几何到 Node 侧已成无 SRID 的裸 GeoJSON，再由 ST_GeomFromGeoJSON 解析为 SRID=0，
  // 与 4326 的探针点做 ST_Covers → "Operation on mixed SRID geometries" 抛错，
  // 被上空 catch 吞成 [] ⇒ 业务表现为"零设施淹没"，SQL/数据/算法全都正常。
  describe('SRID 混用守门 — 4490 库几何 × 4326 入参点', () => {
    // 3490 的等效做法：把 SQUARE 数值上当作 4490 存入库，再取 ST_AsGeoJSON 拿回裸坐标
    const as4490 = `ST_SetSRID(ST_GeomFromGeoJSON($1), 4490)`

    it('直接 ST_AsGeoJSON 4490 几何 → 与 4326 点判定抛错（此即线上故障形态）', async () => {
      await expect(
        db!.query(
          `WITH raw AS (
             SELECT ST_AsGeoJSON(${as4490})::json AS geom
           ), polys AS MATERIALIZED (
             SELECT ST_GeomFromGeoJSON(geom::text) AS geom FROM raw
           )
           SELECT ST_Covers(polys.geom, ST_SetSRID(ST_MakePoint(108.6, 21.85), 4326))
           FROM polys`,
          [JSON.stringify(SQUARE)]
        )
      ).rejects.toThrow(/mixed SRID/i)
    })

    it('ST_AsGeoJSON(ST_Transform(geom, 4326)) → 与 4326 点判定正常命中', async () => {
      const res = await db!.query<{ geom: string }>(
        `WITH raw AS (
           SELECT ST_AsGeoJSON(ST_Transform(${as4490}, 4326))::json AS geom
         )
         SELECT geom::text AS geom FROM raw`,
        [JSON.stringify(SQUARE)]
      )
      // 变换后与 4326 探针点正常命中（以原生算子复核往返一致性）
      const geom = JSON.parse(res.rows[0].geom) as GeoJsonGeometry
      expect(geom.type).toBe('Polygon')
      expect(await spatial.pointIndicesInAnyPolygon([{ lng: 108.6, lat: 21.85 }], [geom])).toEqual([
        0,
      ])
    })
  })
})

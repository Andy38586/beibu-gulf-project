import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DbService } from '../src/infra/db/db.service'
import { GeoJsonGeometry, SpatialRepository } from '../src/infra/db/spatial.repository'

// 空间算子真库套件：需 v3_dev + PostGIS（docker-compose.v3.yml）。无库环境整体跳过，
// 避免 ECONNREFUSED 噪音；联调时 export V3_INTEGRATION_DB=1 恢复全量（与 favorites/plans 同口径）。
//
// 定位：turf→PostGIS 下沉后的**空间正确性守门人**（2026-09-12 起 turf 全面退场，
// 原「与 turf 对照等价」验收随之退役——迁移已验收闭环，对照实现失去存在理由）。
// 现行验收锚点全部为**解析几何不变量**，不依赖任何第二实现：
//   ① 算子自身语义正确：八边形解析面积 2√2·r²（误差 <0.5%）+ 顶点数 8+1、
//      多点并集面积随半径单调不减、交集面积介于 (0, min(输入)]、
//      边界点归属（ST_Covers 边界算在内）、SRID 混用守门
const withDb = process.env.V3_INTEGRATION_DB !== undefined

let db: DbService | undefined
let spatial: SpatialRepository

// 确定性伪随机点集（LCG）：避免测试依赖库内 POI 数据分布，保证跨环境可复现
function samplePoints(n: number, seed = 20260905): Array<{ lng: number; lat: number }> {
  let s = seed
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
  // 集中在一小块区域（约 40km × 20km），制造大量缓冲区重叠——正是旧实现的退化场景
  return Array.from({ length: n }, () => ({
    lng: 108.4 + rnd() * 0.4,
    lat: 21.7 + rnd() * 0.2,
  }))
}

// 多边形顶点计数（含 MultiPolygon）
const nPoints = (g: GeoJsonGeometry): number => {
  const c = g.coordinates as number[][][] | number[][][][]
  return g.type === 'MultiPolygon'
    ? (c as number[][][][]).reduce((s, p) => s + p.reduce((s2, r) => s2 + r.length, 0), 0)
    : (c as number[][][]).reduce((s, r) => s + r.length, 0)
}

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

  describe('unionBuffers — 解析几何不变量', () => {
    it('单点：面积≈正八边形内接圆 2.828·r²（误差 <0.5%）且顶点数一致', async () => {
      const r = 2
      const feat = await spatial.unionBuffers([{ lng: 108.6, lat: 21.85 }], r)
      expect(feat).not.toBeNull()
      // 正八边形内接于圆：A = 2·√2·r² ≈ 2.8284r²
      const area = await spatial.areaKm2(feat!.geometry)
      const ideal = 2 * Math.SQRT2 * r * r
      expect(Math.abs(area - ideal) / ideal).toBeLessThan(0.005)
      expect(nPoints(feat!.geometry)).toBe(9) // 8 顶点 + 闭合点
    })

    it('无点 / 空数组返回 null', async () => {
      expect(await spatial.unionBuffers([], 2)).toBeNull()
    })

    let prevArea = 0
    it.each([0.5, 1, 2, 3])(
      '多点并集：面积正值且随半径单调不减（r=%s km，200 点）',
      async (r: number) => {
        const feat = await spatial.unionBuffers(samplePoints(200), r)
        expect(feat).not.toBeNull()
        const area = await spatial.areaKm2(feat!.geometry)
        expect(area).toBeGreaterThan(0)
        // 同一点集半径增大 → 并集面积单调不减（0.1% 量算容差防抖动）
        expect(area).toBeGreaterThanOrEqual(prevArea * 0.999)
        prevArea = area
        // 顶点规模合理（远大于单点八边形，远小于 200×9 全离散上限）
        const n = nPoints(feat!.geometry)
        expect(n).toBeGreaterThan(8)
        expect(n).toBeLessThan(200 * 9)
      }
    )
  })

  describe('intersect — 解析几何不变量', () => {
    it('相交（重叠充分）：0 < 交集 ≤ min(输入)，且占较小圆 ≥70%（圆心距 1km、半径 3km）', async () => {
      // 两圆心相距 1km、半径 3km：交集占单圆 ~88%，是覆盖求交的代表性形态
      const a = await spatial.unionBuffers([{ lng: 108.6, lat: 21.85 }], 3)
      const b = await spatial.unionBuffers([{ lng: 108.6095, lat: 21.85 }], 3)
      const pg = await spatial.intersect(a!, b!)
      expect(pg).not.toBeNull()

      const [areaA, areaB, areaI] = await Promise.all([
        spatial.areaKm2(a!.geometry),
        spatial.areaKm2(b!.geometry),
        spatial.areaKm2(pg!.geometry),
      ])
      expect(areaI).toBeGreaterThan(0)
      // 交集 ≤ 任一输入（+0.5% 量算容差）
      expect(areaI).toBeLessThanOrEqual(Math.min(areaA, areaB) * 1.005)
      // 重叠充分场景：交集不得塌缩（≥ 较小圆 70%）
      expect(areaI).toBeGreaterThanOrEqual(Math.min(areaA, areaB) * 0.7)
    })

    // 交集很小时面积不追究（透镜状小交集的相对误差量测无第二实现可对照），
    // 改验点面判定与缓冲区几何的**自洽性**：交集内探针点必同时在两输入圆内。
    it('相交（重叠很小）：命中集合 ⊆ 两输入命中交集，且交集带非空', async () => {
      const a = await spatial.unionBuffers([{ lng: 108.6, lat: 21.85 }], 2)
      const b = await spatial.unionBuffers([{ lng: 108.63, lat: 21.85 }], 2)
      const pg = await spatial.intersect(a!, b!)
      expect(pg).not.toBeNull()

      // 采样点覆盖两圆内部、交集带与外部
      const probe: Array<{ lng: number; lat: number }> = []
      for (let i = 0; i <= 20; i++) {
        for (let j = 0; j <= 20; j++) {
          probe.push({ lng: 108.575 + i * 0.004, lat: 21.825 + j * 0.002 })
        }
      }
      const pgHit = await spatial.pointIndicesInGeometry(probe, pg!.geometry)
      const hitA = await spatial.pointIndicesInGeometry(probe, a!.geometry)
      const hitB = await spatial.pointIndicesInGeometry(probe, b!.geometry)

      // 交集带非空，且明显小于两圆（否则本用例退化成平凡情形）
      expect(pgHit.length).toBeGreaterThan(0)
      expect(pgHit.length).toBeLessThan(probe.length)

      // 交集多边形内的点必落在两输入圆内（点面判定与缓冲几何自洽）
      for (const i of pgHit) {
        expect(hitA).toContain(i)
        expect(hitB).toContain(i)
      }
    })

    it('不相交：返回 null（调用方据此标注 failKey）', async () => {
      const a = await spatial.unionBuffers([{ lng: 108.6, lat: 21.85 }], 1)
      const b = await spatial.unionBuffers([{ lng: 114.5, lat: 24.5 }], 1)
      expect(await spatial.intersect(a!, b!)).toBeNull()
    })

    it('几何缺失直接返回 null，不下发 SQL', async () => {
      const a = await spatial.unionBuffers([{ lng: 108.6, lat: 21.85 }], 1)
      expect(await spatial.intersect(a!, null as never)).toBeNull()
    })
  })

  describe('pointIndicesInGeometry — 边界语义（ST_Covers：边界算在内）', () => {
    const points = [
      { lng: 108.6, lat: 21.85 }, // 0 中心（在内）
      { lng: 108.595, lat: 21.845 }, // 1 角内（在内）
      { lng: 108.7, lat: 21.85 }, // 2 东侧远处（在外）
      { lng: 108.55, lat: 21.9 }, // 3 西北远处（在外）
      { lng: 108.61, lat: 21.85 }, // 4 正好落在边界上
    ]

    it('命中下标为已知解析解（含边界点归属）', async () => {
      const hit = await spatial.pointIndicesInGeometry(points, SQUARE)
      // 0/1 在内、2/3 在外、4 恰在边界——ST_Covers 边界算在内（对齐原 turf
      // ignoreBoundary=false 语义，符合洪涝「宁可高估不可低估」原则）
      expect(hit).toEqual([0, 1, 4])
    })

    it('空点集 / 空几何返回空数组', async () => {
      expect(await spatial.pointIndicesInGeometry([], SQUARE)).toEqual([])
      expect(await spatial.pointIndicesInGeometry(points, null as never)).toEqual([])
    })
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
      expect(await spatial.pointIndicesInGeometry([{ lng: 108.6, lat: 21.85 }], geom)).toEqual([0])
    })
  })
})

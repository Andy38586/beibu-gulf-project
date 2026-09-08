import * as turf from '@turf/turf'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DbService } from '../src/infra/db/db.service'
import { GeoJsonGeometry, SpatialRepository } from '../src/infra/db/spatial.repository'

// 空间算子真库套件：需 v3_dev + PostGIS（docker-compose.v3.yml）。无库环境整体跳过，
// 避免 ECONNREFUSED 噪音；联调时 export V3_INTEGRATION_DB=1 恢复全量（与 favorites/plans 同口径）。
//
// 定位：这是 turf→PostGIS 下沉后的**唯一空间正确性守门人**——
//   ① 算子自身语义正确（面积/交集/点面）
//   ② 与旧 turf 实现等价（面积差 <0.5% + 命中集合一致），即本批次的验收标准
// 故 turf 在此作为"对照实现"保留：不是双实现并存，而是把验收标准写成断言。
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

// 参照实现：旧 turf 路径（buffer steps=2 + 分治 union），逐行等价 site-analysis.service 旧版
function unionDivide(list: unknown[]): { geometry: GeoJsonGeometry } | null {
  if (list.length === 1) return list[0] as { geometry: GeoJsonGeometry }
  const mid = Math.floor(list.length / 2)
  const a = unionDivide(list.slice(0, mid))
  const b = unionDivide(list.slice(mid))
  if (!a?.geometry) return b
  if (!b?.geometry) return a
  try {
    // turf 7 的 Feature 泛型与本地 GeoJsonGeometry（string 字面量未收窄）不互认，
    // 参照实现只做面积/顶点对照，类型上按 never 越过（与旧 service 侧 `f as never` 同手法）
    return turf.union(turf.featureCollection([a, b] as never))
  } catch {
    return a
  }
}

const turfUnionBuffers = (points: Array<{ lng: number; lat: number }>, r: number) =>
  unionDivide(
    points.map(
      (p) =>
        turf.buffer(turf.point([p.lng, p.lat]), r, { units: 'kilometers', steps: 2 }) as {
          geometry: GeoJsonGeometry
        }
    )
  )

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

  describe('unionBuffers — 与 turf.buffer(steps=2) 对齐', () => {
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

    it.each([0.5, 1, 2, 3])(
      '多点并集与 turf 面积差 <0.5%（r=%s km，200 点）',
      async (r: number) => {
        const points = samplePoints(200)
        const pgFeat = await spatial.unionBuffers(points, r)
        const turfFeat = turfUnionBuffers(points, r)
        expect(pgFeat).not.toBeNull()
        expect(turfFeat?.geometry).toBeTruthy()

        // 面积用同一把尺子量（都走 ST_Area::geography），排除量算口径差异
        const [pgArea, turfArea] = await Promise.all([
          spatial.areaKm2(pgFeat!.geometry),
          spatial.areaKm2(turfFeat!.geometry),
        ])
        expect(turfArea).toBeGreaterThan(0)
        const diff = Math.abs(pgArea - turfArea) / turfArea
        expect(diff).toBeLessThan(0.005)
        // 顶点数同量级：证明离散精度（quad_segs=2 ⟺ steps=2）确实对齐，非面积巧合
        expect(Math.abs(nPoints(pgFeat!.geometry) - nPoints(turfFeat!.geometry))).toBeLessThan(
          nPoints(turfFeat!.geometry) * 0.05
        )
      }
    )
  })

  describe('intersect — 与 turf.intersect 对齐', () => {
    it('相交（重叠充分）：面积与 turf 差 <0.5%', async () => {
      // 两圆心相距 1km、半径 3km：交集占单圆 ~88%，是覆盖求交的代表性形态
      const a = await spatial.unionBuffers([{ lng: 108.6, lat: 21.85 }], 3)
      const b = await spatial.unionBuffers([{ lng: 108.6095, lat: 21.85 }], 3)
      const pg = await spatial.intersect(a!, b!)
      expect(pg).not.toBeNull()

      const turfA = turf.buffer(turf.point([108.6, 21.85]), 3, { units: 'kilometers', steps: 2 })!
      const turfB = turf.buffer(turf.point([108.6095, 21.85]), 3, {
        units: 'kilometers',
        steps: 2,
      })!
      const turfI = turf.intersect(turf.featureCollection([turfA, turfB]))!

      const [pgArea, turfArea] = await Promise.all([
        spatial.areaKm2(pg!.geometry),
        spatial.areaKm2(turfI.geometry as GeoJsonGeometry),
      ])
      expect(Math.abs(pgArea - turfArea) / turfArea).toBeLessThan(0.005)
    })

    // 交集很小时相对面积误差会被放大：面积误差 ≈ 边界弧长 × 半径系统差（~0.1%），
    // 而交集面积随重叠缩小而二次下降 → 透镜状小交集的相对误差可达 1% 量级。
    // 这种情况下真正影响业务的是"哪些小区落在交集内"，故此处改验命中集合一致。
    it('相交（重叠很小）：面积不追究，但命中集合与 turf 一致', async () => {
      const a = await spatial.unionBuffers([{ lng: 108.6, lat: 21.85 }], 2)
      const b = await spatial.unionBuffers([{ lng: 108.63, lat: 21.85 }], 2)
      const pg = await spatial.intersect(a!, b!)
      expect(pg).not.toBeNull()

      const turfA = turf.buffer(turf.point([108.6, 21.85]), 2, { units: 'kilometers', steps: 2 })!
      const turfB = turf.buffer(turf.point([108.63, 21.85]), 2, { units: 'kilometers', steps: 2 })!
      const turfI = turf.intersect(turf.featureCollection([turfA, turfB]))!

      // 采样点覆盖两圆内部、交集带与外部
      const probe: Array<{ lng: number; lat: number }> = []
      for (let i = 0; i <= 20; i++) {
        for (let j = 0; j <= 20; j++) {
          probe.push({ lng: 108.575 + i * 0.004, lat: 21.825 + j * 0.002 })
        }
      }
      const pgHit = await spatial.pointIndicesInGeometry(probe, pg!.geometry)
      const turfHit = probe
        .map((p, i) => [p, i] as const)
        .filter(([p]) => turf.booleanPointInPolygon(turf.point([p.lng, p.lat]), turfI))
        .map(([, i]) => i)

      // 交集带非空，且明显小于两圆（否则本用例退化成"面积可比"的平凡情形）
      expect(pgHit.length).toBeGreaterThan(0)
      expect(pgHit.length).toBeLessThan(probe.length)

      // 命中集合允许差异，但差异必须只出现在交集边界的极薄外壳内——
      // 若出现深部差异则说明几何整体错位，属真 bug，不是模型差
      // turf 7 的 intersect 返回 Feature|FeatureCollection 联合，polygonToLine 不接受
      // 联合——此处按测试实际（两多边形相交必得 Feature）收窄，与 L44 同款类型绕过
      const boundary = turf.polygonToLine(turfI as never) as never
      const shell = 0.1 // km
      for (const i of pgHit.filter((x) => !turfHit.includes(x))) {
        const p = probe[i]
        const d = turf.distance(
          turf.point([p.lng, p.lat]),
          turf.nearestPointOnLine(boundary, turf.point([p.lng, p.lat])),
          {
            units: 'kilometers',
          }
        )
        expect(d).toBeLessThan(shell)
      }
      for (const i of turfHit.filter((x) => !pgHit.includes(x))) {
        const p = probe[i]
        const d = turf.distance(
          turf.point([p.lng, p.lat]),
          turf.nearestPointOnLine(boundary, turf.point([p.lng, p.lat])),
          {
            units: 'kilometers',
          }
        )
        expect(d).toBeLessThan(shell)
      }
      // 绝大多数点判定一致（边界外壳只占采样点的极小比例）
      const agreed = pgHit.filter((x) => turfHit.includes(x)).length
      expect(agreed).toBeGreaterThan(Math.min(pgHit.length, turfHit.length) - 3)
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

  describe('pointIndicesInGeometry — 与 turf.booleanPointInPolygon 对齐', () => {
    const points = [
      { lng: 108.6, lat: 21.85 }, // 0 中心（在内）
      { lng: 108.595, lat: 21.845 }, // 1 角内（在内）
      { lng: 108.7, lat: 21.85 }, // 2 东侧远处（在外）
      { lng: 108.55, lat: 21.9 }, // 3 西北远处（在外）
      { lng: 108.61, lat: 21.85 }, // 4 正好落在边界上
    ]

    it('命中下标与 turf 逐点一致（含边界点归属）', async () => {
      const hit = await spatial.pointIndicesInGeometry(points, SQUARE)
      const expected = points
        .map((p, i) => [p, i] as const)
        .filter(([p]) => turf.booleanPointInPolygon(turf.point([p.lng, p.lat]), SQUARE as never))
        .map(([, i]) => i)
      expect(hit).toEqual(expected)
      // 边界点（下标 4）必须命中：turf 默认 ignoreBoundary=false，ST_Covers 同语义
      expect(hit).toContain(4)
      expect(hit).toEqual([0, 1, 4])
    })

    it('空点集 / 空几何返回空数组', async () => {
      expect(await spatial.pointIndicesInGeometry([], SQUARE)).toEqual([])
      expect(await spatial.pointIndicesInGeometry(points, null as never)).toEqual([])
    })
  })

  describe('pointIndicesInAnyPolygon — 与 polygons.some(...) 对齐', () => {
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

    it('命中任一多边形即计入，与 some(booleanPointInPolygon) 一致', async () => {
      const hit = await spatial.pointIndicesInAnyPolygon(points, [boxA, boxB])
      const expected = points
        .map((p, i) => [p, i] as const)
        .filter(([p]) =>
          [boxA, boxB].some((g) =>
            turf.booleanPointInPolygon(turf.point([p.lng, p.lat]), g as never)
          )
        )
        .map(([, i]) => i)
      expect(hit).toEqual(expected)
      expect(hit).toEqual([0, 1, 3])
    })

    it('多边形列表为空 → 无命中（不等价于"全部命中"）', async () => {
      expect(await spatial.pointIndicesInAnyPolygon(points, [])).toEqual([])
    })
  })
})

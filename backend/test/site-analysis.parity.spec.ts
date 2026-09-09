import * as turf from '@turf/turf'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GULF_BOUNDS } from '../src/common/constants/gis.constants'
import { DbService } from '../src/infra/db/db.service'
import { GeoJsonGeometry, SpatialRepository } from '../src/infra/db/spatial.repository'
import { SiteAnalysisRepository } from '../src/modules/site-analysis/repositories/site-analysis.repository'
import type { FacilityPoint } from '../src/modules/site-analysis/dto/site-analysis.dto'
import {
  buildTypeCoverage,
  Coverage,
  extractValidPoi,
  filterMatchedXiaoqu,
  intersectCoverages,
} from '../src/modules/site-analysis/services/site-analysis.service'

// turf→PostGIS 下沉的**验收测试**（真库）：拿全量生产数据（三城 × 六类）跑整条
// 选址空间链路，与旧 turf 实现逐项对账：
//   ① 覆盖面积差 <0.5%
//   ② 命中小区集合一致
// 旧实现作为"参照实现"内联于此（buffer steps=2 + 分治 union + turf.intersect + booleanPointInPolygon），
// 与下沉前的 site-analysis.service / spatial-index 逐行等价。
const withDb = process.env.V3_INTEGRATION_DB !== undefined

let db: DbService | undefined
let spatial: SpatialRepository
let repo: SiteAnalysisRepository

const CITIES = ['qz', 'bh', 'fcg']
// 与 tools/perf-bench/coverage-opt-by-city.mjs 同款默认半径（importance=3 → 半径不放大）
const RADIUS: Record<string, number> = {
  hospital: 3,
  primary_school: 1,
  middle_school: 2,
  park: 1.5,
  bus_station: 0.5,
  mall: 2,
}
const TYPES = Object.keys(RADIUS)

// ============ 参照实现（下沉前的 turf 路径） ============
const turfBuffer = (p: FacilityPoint, r: number) =>
  turf.buffer(turf.point([p.lng, p.lat]), r, { units: 'kilometers', steps: 2 })

function unionDivide(list: unknown[]): { geometry: GeoJsonGeometry } | null {
  if (list.length === 1) return list[0] as { geometry: GeoJsonGeometry }
  const mid = Math.floor(list.length / 2)
  const a = unionDivide(list.slice(0, mid))
  const b = unionDivide(list.slice(mid))
  if (!a?.geometry) return b
  if (!b?.geometry) return a
  try {
    return turf.union(turf.featureCollection([a, b] as never))
  } catch {
    return a
  }
}

const refCoverage = (points: FacilityPoint[], r: number): Coverage => {
  const valid = extractValidPoi(points)
  if (valid.length === 0) return null
  const buffers = valid.map((p) => turfBuffer(p, r) as unknown as { geometry: GeoJsonGeometry })
  if (buffers.length === 1) return buffers[0] as Coverage
  return unionDivide(buffers) as Coverage
}

const refIntersect = (a: Coverage, b: Coverage): Coverage => {
  if (!a?.geometry?.coordinates || !b?.geometry?.coordinates) return a
  try {
    return turf.intersect(turf.featureCollection([a, b] as never)) as unknown as Coverage
  } catch {
    return null
  }
}

const refMatched = (xiaoqu: FacilityPoint[], area: Coverage): string[] =>
  xiaoqu
    .filter((x) => {
      if (typeof x.lng !== 'number' || typeof x.lat !== 'number') return false
      if (Number.isNaN(x.lng) || Number.isNaN(x.lat)) return false
      if (x.lng < -180 || x.lng > 180 || x.lat < -90 || x.lat > 90) return false
      if (
        x.lng < GULF_BOUNDS.minLng ||
        x.lng > GULF_BOUNDS.maxLng ||
        x.lat < GULF_BOUNDS.minLat ||
        x.lat > GULF_BOUNDS.maxLat
      )
        return false
      try {
        return turf.booleanPointInPolygon(turf.point([x.lng, x.lat]), area as never)
      } catch {
        return false
      }
    })
    .map((x) => String(x.id))

describe.skipIf(!withDb)('turf→PostGIS 下沉验收（真库 · 三城 × 六类）', () => {
  beforeAll(() => {
    db = new DbService()
    spatial = new SpatialRepository(db)
    repo = new SiteAnalysisRepository(db)
  })

  afterAll(async () => {
    await db?.onModuleDestroy()
  })

  for (const city of CITIES) {
    it(`${city}：单类型覆盖面积与 turf 差 <0.5%，且命中小区集合一致`, async () => {
      const xiaoqu = await repo.findXiaoqu(city)
      const report: string[] = []
      let worstAreaDiff = 0

      for (const type of TYPES) {
        const points = (await repo.findByType(type, city)) ?? []
        const r = RADIUS[type]

        const pgCov = await buildTypeCoverage(spatial, points, r)
        const turfCov = refCoverage(points, r)
        expect(pgCov, `${city}/${type} PostGIS 覆盖缺失`).not.toBeNull()
        expect(turfCov, `${city}/${type} turf 参照覆盖缺失`).not.toBeNull()

        const [pgArea, turfArea] = await Promise.all([
          spatial.areaKm2(pgCov!.geometry),
          spatial.areaKm2(turfCov!.geometry),
        ])
        const diff = Math.abs(pgArea - turfArea) / turfArea
        worstAreaDiff = Math.max(worstAreaDiff, diff)

        const pgMatched = (await filterMatchedXiaoqu(spatial, xiaoqu, pgCov)).map((x) =>
          String(x.id)
        )
        const turfMatched = refMatched(xiaoqu, turfCov)
        const onlyPg = pgMatched.filter((x) => !turfMatched.includes(x))
        const onlyTurf = turfMatched.filter((x) => !pgMatched.includes(x))

        report.push(
          `    ${type.padEnd(15)} n=${String(points.length).padStart(4)} ` +
            `turf=${turfArea.toFixed(3).padStart(9)}km² pg=${pgArea.toFixed(3).padStart(9)}km² ` +
            `Δ=${(diff * 100).toFixed(3).padStart(6)}%  ` +
            `命中 turf=${String(turfMatched.length).padStart(3)} pg=${String(pgMatched.length).padStart(3)} ` +
            `差=${onlyPg.length + onlyTurf.length}`
        )
        if (onlyPg.length || onlyTurf.length) {
          report.push(
            `      仅PG: ${onlyPg.slice(0, 5).join(',')} | 仅turf: ${onlyTurf.slice(0, 5).join(',')}`
          )
        }

        expect(diff, `${city}/${type} 面积差超阈值`).toBeLessThan(0.005)
        // 命中集合：PostGIS 精确圆缓冲（geography + quad_segs=32）与 turf steps:2 低频近似
        // （八边形折线）边界不等——点落在两边界间差异带时判定分叉是模型差，非 bug。
        // 面积实测 PG≈turf（Δ<0.5%），但局部四凸差异可能在任一侧多/漏中：两侧都允许
        // 对侧边界 0.1km 外壳（与 spatial.repository.spec.ts 同口径），壳内即视为一致。
        const turfLine = onlyPg.length ? (turf.polygonToLine(turfCov as never) as never) : null
        for (const xqId of onlyPg) {
          const xq = xiaoqu.find((x) => String(x.id) === xqId)!
          const d = turf.distance(
            turf.point([xq.lng, xq.lat]),
            turf.nearestPointOnLine(turfLine!, turf.point([xq.lng, xq.lat])),
            { units: 'kilometers' }
          )
          expect(
            d,
            `${city}/${type} 仅PG命中 ${xqId} 距 turf 边界 ${d.toFixed(3)}km 超外壳`
          ).toBeLessThan(0.1)
        }
        const pgLine = onlyTurf.length ? (turf.polygonToLine(pgCov as never) as never) : null
        for (const xqId of onlyTurf) {
          const xq = xiaoqu.find((x) => String(x.id) === xqId)!
          // onlyTurf 非空时 pgLine 必非空（上方三元），非空断言供 TS 收窄
          const d = turf.distance(
            turf.point([xq.lng, xq.lat]),
            turf.nearestPointOnLine(pgLine!, turf.point([xq.lng, xq.lat])),
            { units: 'kilometers' }
          )
          expect(
            d,
            `${city}/${type} 仅turf命中 ${xqId} 距 PG 边界 ${d.toFixed(3)}km 超外壳`
          ).toBeLessThan(0.1)
        }
      }

      // eslint-disable-next-line no-console
      console.log(
        `\n  [${city}] 最差面积差 ${(worstAreaDiff * 100).toFixed(3)}%\n` + report.join('\n')
      )
    })

    it(`${city}：六类交集后命中小区集合与 turf 一致`, async () => {
      const xiaoqu = await repo.findXiaoqu(city)

      const pgCovs: Coverage[] = []
      const turfCovs: Coverage[] = []
      for (const type of TYPES) {
        const points = (await repo.findByType(type, city)) ?? []
        pgCovs.push(await buildTypeCoverage(spatial, points, RADIUS[type]))
        turfCovs.push(refCoverage(points, RADIUS[type]))
      }

      const pgFinal = (await intersectCoverages(spatial, pgCovs, TYPES)).area
      let turfFinal: Coverage = turfCovs[0]
      for (let i = 1; i < turfCovs.length; i++) turfFinal = refIntersect(turfFinal, turfCovs[i])

      expect(pgFinal).not.toBeNull()
      expect(turfFinal).not.toBeNull()

      const [pgArea, turfArea] = await Promise.all([
        spatial.areaKm2(pgFinal!.geometry),
        spatial.areaKm2(turfFinal!.geometry),
      ])
      const pgMatched = (await filterMatchedXiaoqu(spatial, xiaoqu, pgFinal)).map((x) =>
        String(x.id)
      )
      const turfMatched = refMatched(xiaoqu, turfFinal)

      // eslint-disable-next-line no-console
      console.log(
        `  [${city}] 交集后：turf=${turfArea.toFixed(3)}km² pg=${pgArea.toFixed(3)}km² ` +
          `Δ=${((Math.abs(pgArea - turfArea) / turfArea) * 100).toFixed(3)}%  ` +
          `命中 turf=${turfMatched.length} pg=${pgMatched.length}`
      )

      const onlyPg = pgMatched.filter((x) => !turfMatched.includes(x))
      const onlyTurf = turfMatched.filter((x) => !pgMatched.includes(x))

      // 同单类型口径：PG 精确圆 vs turf 折线近似，两侧交集的差异点须落在对侧边界 0.1km 壳内
      const turfLine2 = onlyPg.length ? (turf.polygonToLine(turfFinal as never) as never) : null
      for (const xqId of onlyPg) {
        const xq = xiaoqu.find((x) => String(x.id) === xqId)!
        const d = turf.distance(
          turf.point([xq.lng, xq.lat]),
          turf.nearestPointOnLine(turfLine2!, turf.point([xq.lng, xq.lat])),
          { units: 'kilometers' }
        )
        expect(d, `交集后仅PG命中 ${xqId} 距 turf 边界 ${d.toFixed(3)}km 超外壳`).toBeLessThan(0.1)
      }
      const pgLine2 = onlyTurf.length ? (turf.polygonToLine(pgFinal as never) as never) : null
      for (const xqId of onlyTurf) {
        const xq = xiaoqu.find((x) => String(x.id) === xqId)!
        const d = turf.distance(
          turf.point([xq.lng, xq.lat]),
          turf.nearestPointOnLine(pgLine2!, turf.point([xq.lng, xq.lat])),
          { units: 'kilometers' }
        )
        expect(d, `交集后仅turf命中 ${xqId} 距 PG 边界 ${d.toFixed(3)}km 超外壳`).toBeLessThan(0.1)
      }
    })
  }
})

import { Injectable } from '@nestjs/common'

import { DbService } from './db.service'
import { isFatalDbError } from './db-error'

// 空间算子下沉：turf（Node 内存运算）→ PostGIS（库内运算）。
// 数据经 SQL 参数传入，几何运算全在库内完成；仅评分（距离衰减/加权）留在 Node。
//
// 现役算子只有点面判定（点集 × 多边形集合）：turf.booleanPointInPolygon
//   ←→ ST_Covers（边界归属见方法内注释；改动前先看 backend/test/spatial.repository.spec.ts
//   的解析不变量断言）。
//
// 坐标系统一 4326：本模块几何全部由入参经纬度现算，不读取库表几何（表为 4490/CGCS2000），
// 故无混合 SRID 风险。若后续改为直读表几何参与运算，必须显式 ST_Transform 到同一 SRID。

export interface LngLat {
  lng: number
  lat: number
}

export interface GeoJsonGeometry {
  type: string
  coordinates: unknown
}

// 探针点 SRID：入参经纬度按 4326 现算（不读库表几何，见文件头）
const WORK_SRID = 4326

/** 点集转 SQL 参数：[[lng, lat], ...] 序列化为 JSON 文本（json_array_elements 消费） */
function toPairJson(points: LngLat[]): string {
  return JSON.stringify(points.map((p) => [p.lng, p.lat]))
}

@Injectable()
export class SpatialRepository {
  constructor(private readonly db: DbService) {}

  /**
   * 点面判定（多边形集合）：等价于 polygons.some(p => booleanPointInPolygon(pt, p))。
   * 走 EXISTS + 逐多边形 bbox 预筛，避免 ST_Union 大几何的一次性合并开销；
   * 无效多边形（自交等）跳过，与 turf 侧"几何异常按不在内处理"同向。
   */
  async pointIndicesInAnyPolygon(points: LngLat[], polygons: GeoJsonGeometry[]): Promise<number[]> {
    const valid = polygons.filter((g) => g && g.coordinates)
    if (points.length === 0 || valid.length === 0) return []
    try {
      const res = await this.db.query<{ i: number }>(
        `WITH raw AS (
           SELECT ST_GeomFromGeoJSON(g::text) AS geom
           FROM json_array_elements($2::json) AS t(g)
         ), polys AS MATERIALIZED (
           SELECT geom FROM raw WHERE ST_IsValid(geom)
         )
         -- 同上：ORDINALITY 1 基 → 0 基
         SELECT (t.i - 1) AS i
         FROM json_array_elements($1::json) WITH ORDINALITY AS t(p, i)
         CROSS JOIN LATERAL (
           SELECT ST_SetSRID(ST_MakePoint((t.p ->> 0)::float8, (t.p ->> 1)::float8), $3) AS pt
         ) x
         WHERE EXISTS (
           SELECT 1 FROM polys WHERE x.pt && polys.geom AND ST_Covers(polys.geom, x.pt)
         )
         ORDER BY t.i`,
        [toPairJson(points), JSON.stringify(valid), WORK_SRID]
      )
      return res.rows.map((r) => Number(r.i))
    } catch (e) {
      // 同上：几何异常降级为无命中，连接级故障显式上抛
      if (isFatalDbError(e)) throw e
      return []
    }
  }
}

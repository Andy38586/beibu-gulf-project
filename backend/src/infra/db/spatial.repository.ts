import { Injectable } from '@nestjs/common'

import { DbService } from './db.service'
import { isFatalDbError } from './db-error'

// 空间算子下沉：turf（Node 内存运算）→ PostGIS（库内运算）。
// 数据经 SQL 参数传入，几何运算全在库内完成；仅评分（距离衰减/加权）留在 Node。
//
// 口径对齐表（改动前先看 backend/test/spatial.repository.spec.ts 的对照断言）：
//   turf.buffer(p, r, {units:'kilometers', steps:2}) ←→ ST_Buffer(geography, r*1000, 'quad_segs=2')
//       顶点数 4*steps = 8（正八边形）⟺ 每象限 2 段 = 8 段，实测顶点数逐一对齐
//   turf.union(featureCollection)                    ←→ ST_Union 聚合（GEOS 级联并集）
//   turf.intersect(featureCollection([a, b]))        ←→ ST_Intersection
//   turf.booleanPointInPolygon                       ←→ ST_Covers（边界归属见下方注释）
//
// 验收实况（三城 × 六类全量探针）：面积差 0.08%~0.25%，顶点数一致，耗时降 10~50x
//（最坏项 qz/bus_station 723ms→34ms）。字节级一致不可能——turf 球面模型与 PostGIS
// geography 局部投影模型不同，且八边形相位不同；验收线定为「面积差 <0.5% + 命中集合一致」。
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

export interface GeoJsonFeature {
  type: 'Feature'
  properties: Record<string, unknown>
  geometry: GeoJsonGeometry
}

// 与 turf.buffer(steps=2) 对齐：每象限 2 段 → 整圆 8 段正八边形
const BUFFER_QUAD_SEGS = 2

// ST_AsGeoJSON 默认 9 位小数（≈0.1mm），与 turf 原生 float64 的差异远低于验收阈值；
// 顺带压小下发的 coverage 体积
const WORK_SRID = 4326

/** 点集转 SQL 参数：[[lng, lat], ...] 序列化为 JSON 文本（json_array_elements 消费） */
function toPairJson(points: LngLat[]): string {
  return JSON.stringify(points.map((p) => [p.lng, p.lat]))
}

function toFeature(geometry: GeoJsonGeometry | null): GeoJsonFeature | null {
  return geometry ? { type: 'Feature', properties: {}, geometry } : null
}

@Injectable()
export class SpatialRepository {
  constructor(private readonly db: DbService) {}

  /**
   * 缓冲区并集：等价于 turf.buffer(steps=2) 逐点缓冲后 union。
   * 单点为 1 个八边形（Polygon），多点合并后多为 MultiPolygon——与 turf 侧形状同构。
   * 无有效点 / 并集为空返回 null（调用方按"该类型覆盖缺失"处理，不中断流程）。
   */
  async unionBuffers(points: LngLat[], radiusKm: number): Promise<GeoJsonFeature | null> {
    if (points.length === 0) return null
    const lngs = points.map((p) => p.lng)
    const lats = points.map((p) => p.lat)
    try {
      const res = await this.db.query<{ geom: GeoJsonGeometry | null }>(
        `WITH pts AS (
           SELECT ST_SetSRID(ST_MakePoint(lng, lat), $4)::geography AS g
           FROM unnest($1::float8[], $2::float8[]) AS t(lng, lat)
         )
         SELECT ST_AsGeoJSON(ST_Union(ST_Buffer(g, $3, 'quad_segs=${BUFFER_QUAD_SEGS}')::geometry))::json AS geom
         FROM pts`,
        [lngs, lats, radiusKm * 1000, WORK_SRID]
      )
      return toFeature(res.rows[0]?.geom ?? null)
    } catch (e) {
      // 连接级故障显式上抛（→ 全局异常过滤 5xx），绝不吞成"该类型覆盖缺失"；
      // 仅几何/参数类错误按降级契约返回 null——宁可该类型覆盖缺失，也不中断整个选址流程
      if (isFatalDbError(e)) throw e
      return null
    }
  }

  /**
   * 两覆盖区交集：等价于 turf.intersect(featureCollection([a, b]))。
   * 无交集（空几何）返回 null，调用方据此给出 failKey。
   */
  async intersect(a: GeoJsonFeature, b: GeoJsonFeature): Promise<GeoJsonFeature | null> {
    if (!a?.geometry || !b?.geometry) return null
    try {
      const res = await this.db.query<{ geom: GeoJsonGeometry | null }>(
        // ST_CollectionExtract(…, 3)：两个面相交除面外还可能带出线/点（恰好相切时
        // ST_Intersection 会返回 GEOMETRYCOLLECTION），只取面部分；turf 侧对 GC 的
        // 点面判定会直接抛错被吞，等价地表现为"无命中"，此处保留面部分不会更差
        `WITH g AS (
           SELECT ST_CollectionExtract(
                    ST_Intersection(ST_GeomFromGeoJSON($1), ST_GeomFromGeoJSON($2)), 3
                  ) AS geom
         )
         SELECT CASE
                  WHEN geom IS NULL OR ST_IsEmpty(geom) THEN NULL
                  ELSE ST_AsGeoJSON(geom)::json
                END AS geom
         FROM g`,
        [JSON.stringify(a.geometry), JSON.stringify(b.geometry)]
      )
      return toFeature(res.rows[0]?.geom ?? null)
    } catch (e) {
      // 与 turf.intersect 抛错同语义：几何异常按交集断裂降级，交由调用方标注 failKey；
      // 连接级故障不在此列（同 unionBuffers，显式上抛）
      if (isFatalDbError(e)) throw e
      return null
    }
  }

  /**
   * 点面判定（单几何）：返回落入几何内的点在入参数组中的下标（升序）。
   *
   * 用 ST_Covers 而非 ST_Contains：turf.booleanPointInPolygon 默认 ignoreBoundary=false，
   * 落在边界上的点算"在内"；ST_Contains 要求点落在内部，边界点判 false。为保持命中集合
   * 逐点一致，选语义等价的 ST_Covers（边界算在内，同时符合洪涝"宁可高估不可低估"原则）。
   */
  async pointIndicesInGeometry(points: LngLat[], geometry: GeoJsonGeometry): Promise<number[]> {
    if (points.length === 0 || !geometry) return []
    try {
      const res = await this.db.query<{ i: number }>(
        `WITH area AS MATERIALIZED (
           SELECT ST_GeomFromGeoJSON($2) AS geom
         )
         -- WITH ORDINALITY 自 1 起计，下标需回落到入参数组的 0 基
         SELECT (t.i - 1) AS i
         FROM json_array_elements($1::json) WITH ORDINALITY AS t(p, i)
         CROSS JOIN area
         CROSS JOIN LATERAL (
           SELECT ST_SetSRID(ST_MakePoint((t.p ->> 0)::float8, (t.p ->> 1)::float8), $3) AS pt
         ) x
         WHERE area.geom IS NOT NULL
           AND ST_IsValid(area.geom)
           AND x.pt && area.geom
           AND ST_Covers(area.geom, x.pt)
         ORDER BY t.i`,
        [toPairJson(points), JSON.stringify(geometry), WORK_SRID]
      )
      return res.rows.map((r) => Number(r.i))
    } catch (e) {
      // 几何异常（自交/空环）按无命中处理，不中断整批评估（对齐原 per-polygon try/catch）；
      // 连接级故障显式上抛，防"假无命中"
      if (isFatalDbError(e)) throw e
      return []
    }
  }

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

  /** 几何面积（km²，测地面积）——验收对照与测试断言用，非业务路径 */
  async areaKm2(geometry: GeoJsonGeometry): Promise<number> {
    const res = await this.db.query<{ area: string | null }>(
      'SELECT ST_Area(ST_GeomFromGeoJSON($1)::geography) / 1e6 AS area',
      [JSON.stringify(geometry)]
    )
    return Number(res.rows[0]?.area ?? 0)
  }
}

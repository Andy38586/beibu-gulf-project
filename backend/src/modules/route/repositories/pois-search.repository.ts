import { Injectable } from '@nestjs/common'

import { DbService } from '../../../infra/db/db.service'

// POI 多源搜索（航线分析选点）。2026-09-30 自 site-analysis 迁入本域——
// 其唯一消费者是航线分析（useRouteApi.ts ENDPOINTS.siteAnalysis.pois → 迁后 /route-analysis/pois），
// 迁移是「老选址隔离」的一部分：迁完 site-analysis 即可整体删除（隔离工单见
// docs/老选址隔离与移除工单-2026-09-30.md）。SQL 原样搬迁（多源并集+优先级排序），
// 不改口径；xiaoqu/poi_facilities 表在老选址删除后仍由本查询消费（数据保留）。

export interface PoiSearchRow {
  source: string
  id: string
  name: string
  type: string
  city: string | null
  district: string | null
  lng: number
  lat: number
}

const MULTI_SOURCE_SEARCH_SQL = `
SELECT source, id, name, type, city, district,
       ST_X(ST_Transform(geom, 4326)) AS lng,
       ST_Y(ST_Transform(geom, 4326)) AS lat
FROM (
  SELECT 'port'::text AS source, 0 AS prio, id, name, COALESCE(type, '') AS type,
         NULL::text AS city, NULL::text AS district, geom
    FROM ports
  UNION ALL
  SELECT 'facility', 1, id, name, COALESCE(type, ''), NULL::text, NULL::text, geom
    FROM flood_facilities
  UNION ALL
  SELECT 'xiaoqu', 2, id, name, 'xiaoqu', city, district, geom
    FROM xiaoqu
  UNION ALL
  SELECT 'poi', 3, id, name, COALESCE(type, ''), city, district, geom
    FROM poi_facilities
) s
WHERE ($1::text IS NULL OR name ILIKE $1)
ORDER BY prio, city NULLS FIRST, name
LIMIT $2
`

@Injectable()
export class PoiSearchRepository {
  constructor(private readonly db: DbService) {}

  async searchPois(keyword: string, limit: number): Promise<PoiSearchRow[]> {
    // 逐字对齐原 site-analysis 实现（迁移等价；0/NaN→缺省 50，NULL 字段归一空串）
    const safeLimit = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200)
    const kw = keyword.trim()
    const res = await this.db.query<PoiSearchRow>(MULTI_SOURCE_SEARCH_SQL, [
      kw ? `%${kw}%` : null,
      safeLimit,
    ])
    return res.rows.map((row) => ({
      id: row.id ?? '',
      name: row.name ?? '',
      type: row.type ?? '',
      source: row.source,
      city: row.city ?? '',
      district: row.district,
      lng: row.lng,
      lat: row.lat,
    }))
  }
}

import { Injectable } from '@nestjs/common'

import { DbService } from '../../../infra/db/db.service'
import type { FacilityPoint, PoiSearchItem } from '../dto/site-analysis.dto'

// 选址分析数据访问：POI/小区自 PostGIS 读取（poi_facilities/xiaoqu 表，EPSG:4490），
// 取代原 backend/data/site-selection/{city}_{type}.json 文件读取——消除 POI 双轨
//（库中数据与 JSON 全量对账一致：六类逐类 count 相等，小区 2456=1247+666+543 相等；
// port_pier 库版少 15 条系入库时跨类目去重，非选址评分类型，不影响本模块）。
// 空间计算仍走 turf 内存运算（turf→PostGIS 下沉属独立改动，验收标准：面积差<0.5%）。

// 城市白名单：city 来自外部请求体，必须白名单校验后才能拼参（SQL 参数化，无路径拼接面）
const CITIES = ['qz', 'bh', 'fcg'] as const
export const DEFAULT_CITY = 'qz'

// 参与选址的设施类型白名单（poi_facilities.type 值域中本模块消费的子集；
// port_pier 虽在库但不参与评分——与原 FILE_MAP 键集等价）
const ANALYSIS_TYPES = [
  'hospital',
  'primary_school',
  'middle_school',
  'park',
  'bus_station',
  'mall',
] as const

export function isSupportedCity(city: unknown): boolean {
  return (CITIES as readonly string[]).includes(city as string)
}

export function getAvailableCities(): string[] {
  return [...CITIES]
}

// 归一化：非法/缺失一律回落默认城市，不抛错（选址是纯计算接口，不应因 city 参数 4xx）
function resolveCity(city: unknown): string {
  return isSupportedCity(city) ? (city as string) : DEFAULT_CITY
}

// 行形状：geom 拆 lng/lat（ST_Transform(4326) 后再取 X/Y，4490 不对外）；TEXT 列 NULL 归 undefined（FacilityPoint 可选字段
// 语义是"未提供"而非 null——迁移时实锤：PG null 直传与索引签名类型不兼容，tsc watch 拦截）
interface PoiRow {
  id: string | null
  name: string | null
  lng: number
  lat: number
  district: string | null
}

// null → undefined 归一：保持 FacilityPoint 契约（id/name 缺失由下游过滤逻辑处理）
function toFacilityPoint(row: PoiRow): FacilityPoint {
  const point: FacilityPoint = { lng: row.lng, lat: row.lat }
  if (row.id != null) point.id = row.id
  if (row.name != null) point.name = row.name
  if (row.district != null) point.district = row.district
  return point
}

// 搜索结果行形状：name/type 为业务必需列（NOT NULL），district 可空；source = 来源点集
interface PoiSearchRow {
  id: string | null
  name: string | null
  type: string | null
  source: string
  city: string | null
  district: string | null
  lng: number
  lat: number
}

/**
 * 多源点集搜索：航线分析选点的候选点**不止 POI**——港口/淹没设施点/小区同样是合法路径端点。
 *
 * 背景（2026-09-12 用户反馈「引入的 POI 点太少、列表没用」）：原实现只查 poi_facilities 一张表，
 * 且默认 `ORDER BY city, type, id` 把兜底列表压成"一堆同城公交站"。真因不是库里点少
 *（实测任意关键词都命中上限），而是**源窄 + 上限小 + 排序无意义**。
 *
 * 现改为 UNION 四个真实点集，并按 source 优先级排序（航线天然端点在前）：
 *   port（港口 3）→ facility（淹没设施点 83）→ xiaoqu（小区）→ poi（设施 POI）
 * source 列随行下发，前端按来源显示标签；不再靠 type 猜来源。
 *
 * keyword 为空 → 无条件（返回优先级前 limit 条兜底列表）；有词 → `name ILIKE`（参数化无拼接面）。
 */
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
export class SiteAnalysisRepository {
  constructor(private readonly db: DbService) {}

  async findByType(type: string, city: unknown): Promise<FacilityPoint[] | null> {
    if (!(ANALYSIS_TYPES as readonly string[]).includes(type)) return null
    const res = await this.db.query<PoiRow>(
      `SELECT id, name, ST_X(ST_Transform(geom, 4326)) AS lng, ST_Y(ST_Transform(geom, 4326)) AS lat, district
       FROM poi_facilities
       WHERE type = $1 AND city = $2
       ORDER BY id`,
      [type, resolveCity(city)]
    )
    return res.rows.map(toFacilityPoint)
  }

  async findXiaoqu(city: unknown): Promise<FacilityPoint[]> {
    const res = await this.db.query<PoiRow>(
      `SELECT id, name, ST_X(ST_Transform(geom, 4326)) AS lng, ST_Y(ST_Transform(geom, 4326)) AS lat, district
       FROM xiaoqu
       WHERE city = $1
       ORDER BY id`,
      [resolveCity(city)]
    )
    return res.rows.map(toFacilityPoint)
  }

  // 名称关键词搜索（航线分析选点）：多源点集（见 MULTI_SOURCE_SEARCH_SQL）。
  // 上限防御：limit 钳制 1..200（0/NaN 视为未提供 → 缺省 50）——四类点集合并后 50 太小
  //（用户会想"再多看几条"），200 行载荷仍属轻量；更大量级才需要分页，当前不做
  async searchPois(keyword: string, limit: number): Promise<PoiSearchItem[]> {
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

  getAvailableTypes(): string[] {
    return [...ANALYSIS_TYPES]
  }
}

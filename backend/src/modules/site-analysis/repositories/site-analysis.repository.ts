import { Injectable } from '@nestjs/common'

import { DbService } from '../../../infra/db/db.service'
import { FacilityPoint } from '../services/scoring'

// 选址分析数据访问：POI/小区自 PostGIS 读取（poi_facilities/xiaoqu 表，EPSG:4490），
// 取代原 backend/data/site-selection/{city}_{type}.json 文件读取——消除 POI 双轨
//（库中数据与 JSON 全量对账一致：六类逐类 count 相等，小区 2456=1247+666+543 相等；
// port_pier 库版少 15 条系入库时跨类目去重，非选址评分类型，不影响本模块）。
// 空间计算仍走 turf 内存运算（turf→PostGIS 下沉属独立批次，验收标准：面积差<0.5%）。

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

// 行形状：geom 拆 lng/lat（ST_X/ST_Y），district 附加透传（FacilityPoint 有索引签名）
interface PoiRow {
  id: string | null
  name: string | null
  lng: number
  lat: number
  district: string | null
}

@Injectable()
export class SiteAnalysisRepository {
  constructor(private readonly db: DbService) {}

  async findByType(type: string, city: unknown): Promise<FacilityPoint[] | null> {
    if (!(ANALYSIS_TYPES as readonly string[]).includes(type)) return null
    const res = await this.db.query<PoiRow>(
      `SELECT id, name, ST_X(geom) AS lng, ST_Y(geom) AS lat, district
       FROM poi_facilities
       WHERE type = $1 AND city = $2
       ORDER BY id`,
      [type, resolveCity(city)]
    )
    return res.rows
  }

  async findXiaoqu(city: unknown): Promise<FacilityPoint[]> {
    const res = await this.db.query<PoiRow>(
      `SELECT id, name, ST_X(geom) AS lng, ST_Y(geom) AS lat, district
       FROM xiaoqu
       WHERE city = $1
       ORDER BY id`,
      [resolveCity(city)]
    )
    return res.rows
  }

  getAvailableTypes(): string[] {
    return [...ANALYSIS_TYPES]
  }
}

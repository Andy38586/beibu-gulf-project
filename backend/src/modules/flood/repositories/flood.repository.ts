import { Injectable } from '@nestjs/common'

import { DbService } from '../../../infra/db/db.service'
import { DataFilesService } from '../../../infra/files/data-files.service'

// 洪涝数据访问（对齐 Express floodRepository 六层收口：数据访问统一经 repository，
// service 层禁止裸 SQL——SQL 一律收在本层）。
//
// 双数据源并存（2026-09-10 起）：
//   · 档位淹没范围 → PostGIS `flood_levels`（251 档，0.1m 步长）——取代 floodArea.json 的 6 档
//   · 其余（statistics / facilityPoints / waterArea / terrainProfile）→ 仍读 JSON
// 迁移动机：生产实际跑的是 floodArea.json 的 **6 档**（0/2/5/8/10/15），而 251 档精细数据
// 此前只存在于 FastAPI 且属死代码路径（前端 dataSource 硬编码 'fetch'）→ 本表把精细数据
// 接回生产链路，消除精度退化。
//
// SQL 放本 repository 而非 SpatialRepository：后者收口"空间算子"
//（unionBuffers/intersect/pointIndicesInAnyPolygon/areaKm2），本处是 flood 域专属取数。
const FLOOD_FILES = {
  floodArea: 'flood/floodArea.json',
  floodStatistics: 'flood/floodStatistics.json',
  facilityPoints: 'flood/facilityPoints.json',
  waterArea: 'flood/water-area.json',
  terrainProfile: 'flood/terrainProfile.json',
} as const

/**
 * flood_levels 查询行（一个多边形一行；无淹没档位 geom 为 NULL，经 LEFT JOIN 仍保留一行）。
 * NUMERIC 经 node-postgres 返回 string，调用方需 Number() 转换。
 */
export interface FloodLevelFeatureRow {
  level: string
  feature_count: number
  flooded_km2: string
  geometry: string | null
  area: string | null
}

// 取档查询（向上取档）：
//   picked   = >= 请求水位的最低档（与 FastAPI _level_key 的 ceil 同向——宁可高估风险不可低估）
//   fallback = 超档（水位 > 25）时回落最高档（对齐原 pickZone 的「超档取最高档」语义）
//   LEFT JOIN LATERAL ST_Dump：档位无几何（如 0 档）时仍返回该档一行，使调用方能区分
//   「档位存在但无淹没」与「表为空」两种情形
// 几何由灌数脚本手工拼 MULTIPOLYGON 生成（等价 ST_Collect、非 ST_Union），故此处
// ST_Dump 拆出的多边形集合与原 features 数组一一对应（灌数脚本内含 feature_count 断言保证）。
const PICK_LEVEL_SQL = `
WITH picked AS (
  SELECT level, feature_count, flooded_km2, geom, 0 AS pri
  FROM flood_levels
  WHERE level >= $1
  ORDER BY level
  LIMIT 1
),
fallback AS (
  SELECT level, feature_count, flooded_km2, geom, 1 AS pri
  FROM flood_levels
  ORDER BY level DESC
  LIMIT 1
),
chosen AS (
  SELECT level, feature_count, flooded_km2, geom
  FROM (SELECT * FROM picked UNION ALL SELECT * FROM fallback) t
  ORDER BY pri
  LIMIT 1
)
SELECT c.level, c.feature_count, c.flooded_km2,
       ST_AsGeoJSON(d.geom) AS geometry,
       ROUND(ST_Area(d.geom)::numeric, 6) AS area
FROM chosen c
LEFT JOIN LATERAL ST_Dump(c.geom) AS d ON TRUE
ORDER BY ST_Area(d.geom) DESC NULLS LAST
`

// 全档位查询（未指定 waterLevel 时使用）。
// ⚠️ 251 档 × 全部多边形，响应体积大（28MB 级）；前端 floodAdapter 恒传 waterLevel，
// 该路径为兼容保留，不属正常调用路径。
const LIST_LEVELS_SQL = `
SELECT l.level, l.feature_count, l.flooded_km2,
       ST_AsGeoJSON(d.geom) AS geometry,
       ROUND(ST_Area(d.geom)::numeric, 6) AS area
FROM flood_levels l
LEFT JOIN LATERAL ST_Dump(l.geom) AS d ON TRUE
ORDER BY l.level, ST_Area(d.geom) DESC NULLS LAST
`

@Injectable()
export class FloodRepository {
  constructor(
    private readonly dataFiles: DataFilesService,
    private readonly db: DbService
  ) {}

  /** 取指定水位的档位多边形（向上取档；超档回落最高档）。返回空数组 = 表未灌数。 */
  async pickFloodLevel(level: number): Promise<FloodLevelFeatureRow[]> {
    const res = await this.db.query<FloodLevelFeatureRow>(PICK_LEVEL_SQL, [level])
    return res.rows
  }

  /** 取全部档位多边形（未指定水位路径）。 */
  async listFloodLevels(): Promise<FloodLevelFeatureRow[]> {
    const res = await this.db.query<FloodLevelFeatureRow>(LIST_LEVELS_SQL)
    return res.rows
  }

  readFloodArea(): Promise<unknown> {
    return this.dataFiles.read(FLOOD_FILES.floodArea)
  }

  readFloodStatistics(): Promise<unknown> {
    return this.dataFiles.read(FLOOD_FILES.floodStatistics)
  }

  readFacilityPoints(): Promise<unknown> {
    return this.dataFiles.read(FLOOD_FILES.facilityPoints)
  }

  readWaterArea(): Promise<unknown> {
    return this.dataFiles.read(FLOOD_FILES.waterArea)
  }

  readTerrainProfile(): Promise<unknown> {
    return this.dataFiles.read(FLOOD_FILES.terrainProfile)
  }
}

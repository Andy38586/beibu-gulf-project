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
       -- ST_MakeValid 必须保留：源数据按 ST_Collect 语义"仅聚集不合并"（灌数脚本约束，
       -- 防 ST_Union 融合破坏 features 对应关系），档位多边形因此含自交/重叠 → 个别部件
       -- ST_IsValid=false。下游 pointIndicesInAnyPolygon 会按"无效多边形跳过"预筛丢弃
       -- 这些部件——2026-09-12 实证 3m/20m 档全部命中设施恰落在被丢弃部件里（SQL 复现：
       -- 3m 丢弃 2 个部件 → 16 处设施归零；20m 丢弃 1 个 → 47 处归零），灾害评估假绿灯。
       -- 在领域边界自愈（点面判定与前端绘制共用本出口），不动通用空间算子语义。
       -- CASE 门控：valid 片零开销（全档无水位路径 4869 片全量 MakeValid 会拖过 5s 测试阈值）
       -- 陆域裁剪（2026-09-12）：与行政区划并集（admin_boundary_union，钦北防 12 区县）求交，
       -- 只下发区划内淹没面——海上淹没面无展示价值且喧宾夺主（用户口径：只显示交集）。
       -- CollectionExtract(…,3)：相切时 ST_Intersection 可能带出线/点碎片，只留面。
       -- 0 档 NULL 几何行经 WHERE 首分支保留（「档位存在但无淹没」语义不破坏）。
       -- 全档无水位兼容路径（LIST_LEVELS_SQL）不裁剪，原样下发。
       ST_AsGeoJSON(x.clip) AS geometry,
       ROUND(ST_Area(t.g)::numeric, 6) AS area
FROM chosen c
LEFT JOIN LATERAL ST_Dump(c.geom) AS d ON TRUE
CROSS JOIN LATERAL (SELECT ST_Transform(d.geom, 4326) AS g) t
CROSS JOIN (SELECT geom AS b FROM admin_boundary_union) a
CROSS JOIN LATERAL (
  SELECT ST_CollectionExtract(
           ST_Intersection(CASE WHEN ST_IsValid(t.g) THEN t.g ELSE ST_MakeValid(t.g) END, a.b), 3
         ) AS clip
) x
WHERE d.geom IS NULL OR (x.clip IS NOT NULL AND NOT ST_IsEmpty(x.clip))
ORDER BY ST_Area(t.g) DESC NULLS LAST
`

// 全档位查询（未指定 waterLevel 时使用）。
// ⚠️ 251 档 × 全部多边形，响应体积大（28MB 级）；前端 floodAdapter 恒传 waterLevel，
// 该路径为兼容保留，不属正常调用路径。
const LIST_LEVELS_SQL = `
SELECT l.level, l.feature_count, l.flooded_km2,
       -- ST_MakeValid：与 PICK_LEVEL_SQL 同因（源数据含自交部件，防下游按无效跳过）；
       -- CASE 门控同口径（valid 片零开销）
       ST_AsGeoJSON(CASE WHEN ST_IsValid(t.g) THEN t.g ELSE ST_MakeValid(t.g) END) AS geometry,
       ROUND(ST_Area(t.g)::numeric, 6) AS area
FROM flood_levels l
LEFT JOIN LATERAL ST_Dump(l.geom) AS d ON TRUE
CROSS JOIN LATERAL (SELECT ST_Transform(d.geom, 4326) AS g) t
ORDER BY l.level, ST_Area(t.g) DESC NULLS LAST
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

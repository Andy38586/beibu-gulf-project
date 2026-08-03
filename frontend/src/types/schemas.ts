/**
 * 外部数据边界 zod 运行时校验 schema 集中定义
 * 设计原则：
 * - 与现有 `types/` 下的 interface 并存，不替换原有类型声明
 * - schema 用于外部数据边界（HTTP 响应、localStorage、sessionStorage、JSON.parse）的运行时校验
 * - 用 `z.infer<>` 导出类型供边界文件使用，原始 interface 仍为业务层主类型
 * zod 版本：v4（z.record 需 (keyType, valueType) 双参数；passthrough 已弃用，用 z.looseObject）
 */
import { z } from 'zod'

// ==================== ① User Schema ====================
// 对应 `frontend/src/types/api.ts` 的 User interface
// 用于 useAuth.ts 的 localStorage 读取校验
export const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  createdAt: z.string(),
})

export type UserParsed = z.infer<typeof userSchema>

// ==================== ② AnalysisResult Storage Schema ====================
// core 层（mapStore）不反向依赖业务 AnalysisResult，存储层用 Record<string, unknown>。
// 此 schema 仅校验反序列化结果为 plain object（拒绝 null/array/primitive），
// 不约束具体字段——业务层读取时自行 cast 为 AnalysisResult。
export const analysisResultSchema = z.record(z.string(), z.unknown())

export type AnalysisResultParsed = z.infer<typeof analysisResultSchema>

// ==================== ③ Flood Online Response Schema ====================
// 对应 floodAdapter `_fetchOnlineFlood` 的返回类型（FastAPI 在线演算响应）
// 顶层字段严格校验；features 元素用 unknown（下游 map 时自行 cast 为 FloodFeature[]）
export const floodOnlineResponseSchema = z.object({
  level: z.number(),
  featureCount: z.number(),
  floodedKm2: z.number(),
  features: z.array(z.unknown()),
})

export type FloodOnlineResponseParsed = z.infer<typeof floodOnlineResponseSchema>

// ==================== ④ Boundary Cache Schema ====================
// 对应 useBoundaryLayer.ts 的 sessionStorage 缓存结构 { data: FeatureCollection, timestamp: number }
// 用 z.looseObject 保留未知键（FeatureCollection 可能有 bbox 等额外字段），
// data 内层仅校验 type 与 features 数组存在，feature 元素用 unknown（已由 loadBoundaryGeoJson 首次加载时校验）
export const boundaryCacheSchema = z.looseObject({
  data: z.looseObject({
    type: z.literal('FeatureCollection'),
    features: z.array(z.unknown()),
  }),
  timestamp: z.number(),
})

export type BoundaryCacheParsed = z.infer<typeof boundaryCacheSchema>

// ==================== ⑤ Auth Response Schema ====================
// useAuth 的 /auth/me、/auth/login、/auth/register 响应（{ user, token? }）
export const authResponseSchema = z.object({
  user: userSchema,
  // @deprecated d038: token 已移至 HttpOnly Cookie,响应体不再回传;optional 兼容旧响应
  token: z.string().optional(),
})

export type AuthResponseParsed = z.infer<typeof authResponseSchema>

// ==================== ⑥ Forecast TimeSeries Schema ====================
// forecastAdapter /forecast/timeseries 响应（TimeSeriesResponse）
export const forecastPointSchema = z.object({
  time: z.string(),
  value: z.number(),
  type: z.enum(['historical', 'forecast']),
})

export const timeSeriesResponseSchema = z.object({
  indicator: z.string(),
  unit: z.string(),
  granularity: z.string(),
  series: z.array(
    z.object({
      portId: z.string(),
      portName: z.string(),
      data: z.array(forecastPointSchema),
    })
  ),
})

export type TimeSeriesResponseParsed = z.infer<typeof timeSeriesResponseSchema>

// ==================== ⑦ Forecast IndicatorComparison Schema ====================
// forecastAdapter /forecast/indicator/:indicator 响应（IndicatorComparisonResponse）
export const indicatorComparisonResponseSchema = z.object({
  indicator: z.string(),
  unit: z.string(),
  ports: z.record(
    z.string(),
    z.object({
      portName: z.string(),
      value: z.number().nullable(),
      historical: z.array(forecastPointSchema),
      forecast: z.array(forecastPointSchema),
    })
  ),
})

export type IndicatorComparisonResponseParsed = z.infer<typeof indicatorComparisonResponseSchema>

// ==================== ⑧ Forecast Map Schema ====================
// forecastAdapter /forecast/map 响应（ForecastMapData,GeoJSON FeatureCollection）
export const forecastMapDataSchema = z.looseObject({
  indicator: z.string(),
  unit: z.string(),
  time: z.string(),
  type: z.literal('FeatureCollection'),
  features: z.array(
    z.looseObject({
      type: z.literal('Feature'),
      geometry: z.looseObject({
        type: z.string(),
        coordinates: z.array(z.number()),
      }),
      properties: z.looseObject({
        portId: z.string(),
        portName: z.string(),
        value: z.number(),
      }),
    })
  ),
})

export type ForecastMapDataParsed = z.infer<typeof forecastMapDataSchema>

// ==================== ⑨ Forecast Overview Schema ====================
// forecastAdapter /forecast/overview 响应（ForecastIndicatorIndex）
export const forecastIndicatorIndexSchema = z.object({
  metadata: z.object({
    version: z.string(),
    lastUpdated: z.string(),
    ports: z.array(
      z.object({ id: z.string(), name: z.string(), lat: z.number(), lng: z.number() })
    ),
    indicators: z.array(z.string()),
  }),
  historical: z.object({ start: z.string(), end: z.string() }),
  forecast: z.object({ start: z.string(), end: z.string() }),
})

export type ForecastIndicatorIndexParsed = z.infer<typeof forecastIndicatorIndexSchema>

// ==================== ⑩ Plan Schema ====================
// usePlans 的 /plans CRUD 响应（Plan;嵌套复杂字段宽松化）
export const planSchema = z.looseObject({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  selectedKeys: z.array(z.string()),
  typeSettings: z.record(z.string(), z.unknown()),
  // savedXiaoqu 必须 optional：存量 plans.json 记录(实测 18 条中仅 1 条)无此字段,
  // 必填会拒绝旧数据（运行时断链）
  savedXiaoqu: z.array(z.unknown()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  businessType: z.string().optional(),
  waterLevel: z.number().optional(),
  totalLoss: z.number().optional(),
  floodRiskLevel: z.string().optional(),
})

export type PlanParsed = z.infer<typeof planSchema>

// ==================== ⑪ Water Area Schema ====================
// floodAdapter /flood/water-area 响应（后端返回坐标数组 [[lng,lat],...]）
export const waterAreaSchema = z.array(z.tuple([z.number(), z.number()]))

export type WaterAreaParsed = z.infer<typeof waterAreaSchema>

// ==================== ⑫ Terrain Profile Schema ====================
// WaterLevelProfilePanel /flood/terrain-profiles 响应（TerrainProfile[]）
export const terrainProfileSchema = z.array(
  z.looseObject({
    id: z.string(),
    name: z.string(),
    port: z.string().optional(),
    description: z.string().optional(),
    points: z.array(
      z.object({ distance: z.number(), lng: z.number(), lat: z.number(), elevation: z.number() })
    ),
  })
)

export type TerrainProfileParsed = z.infer<typeof terrainProfileSchema>

// ==================== ⑬ Site Analysis Response Schema ====================
// siteAnalysisAdapter /site-analysis 响应（AnalysisResult;GeoJSON 不深校验）
export const siteAnalysisResponseSchema = z.looseObject({
  error: z.string().nullable(),
  coverage: z.unknown().nullable(),
  matchedXiaoqu: z
    .array(
      z.looseObject({
        id: z.string().optional(),
        name: z.string().optional(),
        score: z.number().optional(),
        lng: z.number().optional(),
        lat: z.number().optional(),
      })
    )
    .optional(),
  facilityPoi: z.record(z.string(), z.unknown()).optional(),
})

export type SiteAnalysisResponseParsed = z.infer<typeof siteAnalysisResponseSchema>

// ==================== ⑭ Flood Areas Response Schema ====================
// floodAdapter /flood/flood-areas?waterLevel 响应（后端 getFloodAreas 带水位分支）
// features 元素用 unknown（GeoJSON Feature,下游 _mapFloodFeatures 收窄）
export const floodAreasResponseSchema = z.looseObject({
  waterLevel: z.number(),
  requestedWaterLevel: z.number().optional(),
  actualWaterLevel: z.number().optional(),
  riskLevel: z.string(),
  features: z.array(z.unknown()),
})

export type FloodAreasResponseParsed = z.infer<typeof floodAreasResponseSchema>

// ==================== ⑮ Flood Statistics Response Schema ====================
// floodAdapter /flood/flood-statistics?waterLevel 响应（floodStatistics.json statistics 元素）
export const floodStatisticsResponseSchema = z.looseObject({
  waterLevel: z.number().optional(),
  riskLevel: z.string(),
  riskLevelCode: z.number().optional(),
  floodArea: z.number().optional(),
  averageDepth: z.number().optional(),
  maxDepth: z.number().optional(),
  affectedFacilities: z.number().optional(),
  affectedPorts: z.array(z.string()).optional(),
  estimatedLoss: z.number().optional(),
  description: z.string().optional(),
  totalArea: z.number().optional(),
  affectedCount: z.number().optional(),
})

export type FloodStatisticsResponseParsed = z.infer<typeof floodStatisticsResponseSchema>

// ==================== ⑯ Flood Disaster Response Schema ====================
// floodAdapter /flood/analysis/disaster 响应（assessDisaster 结果）
// affectedFacilities 元素用 unknown（下游 _mapAffectedFacilities 收窄）
export const floodDisasterResponseSchema = z.looseObject({
  waterLevel: z.number(),
  requestedWaterLevel: z.number().optional(),
  riskLevel: z.string(),
  affectedFacilities: z.array(z.unknown()),
  totalLoss: z.number(),
})

export type FloodDisasterResponseParsed = z.infer<typeof floodDisasterResponseSchema>

/**
 * 外部数据边界（HTTP 响应 / localStorage / JSON.parse）的 zod 运行时校验 schema。
 * 与 types/ 下 interface 并存，用 z.infer 导出解析类型；zod v4 语法（z.record 双参数、z.looseObject）。
 */
import { z } from 'zod'

// ① User（useAuth 的 localStorage 读取校验）
export const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  createdAt: z.string(),
})

export type UserParsed = z.infer<typeof userSchema>

// ② mapStore 持久化的 AnalysisResult——仅校验为 plain object，字段由业务层自行收窄
export const analysisResultSchema = z.record(z.string(), z.unknown())

export type AnalysisResultParsed = z.infer<typeof analysisResultSchema>

// ③ /flood 在线演算响应（顶层字段严格校验，features 元素由下游收窄为 FloodFeature[]）
export const floodOnlineResponseSchema = z.object({
  level: z.number(),
  featureCount: z.number(),
  floodedKm2: z.number(),
  features: z.array(z.unknown()),
})

export type FloodOnlineResponseParsed = z.infer<typeof floodOnlineResponseSchema>

// ④ 边界 GeoJSON 的 sessionStorage 缓存结构（looseObject 保留额外键，features 元素首次加载时已校验）
export const boundaryCacheSchema = z.looseObject({
  data: z.looseObject({
    type: z.literal('FeatureCollection'),
    features: z.array(z.unknown()),
  }),
  timestamp: z.number(),
})

export type BoundaryCacheParsed = z.infer<typeof boundaryCacheSchema>

// ⑤ 认证响应（{ user, token? }）
export const authResponseSchema = z.object({
  user: userSchema,
  // @deprecated：token 已移至 HttpOnly Cookie，响应体不再回传；optional 兼容旧响应
  token: z.string().optional(),
})

export type AuthResponseParsed = z.infer<typeof authResponseSchema>

// ⑥ /forecast/timeseries 响应
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

// ⑦ /forecast/indicator/:indicator 响应
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

// ⑧ /forecast/map 响应（GeoJSON FeatureCollection）
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

// ⑨ /forecast/overview 响应
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
  // 首页概览图表快照（useOverviewCharts 消费；looseObject 兼容字段演进）
  charts: z
    .looseObject({
      indicator: z.string(),
      unit: z.string(),
      granularity: z.string().optional(),
      start: z.string().optional(),
      end: z.string().optional(),
      labels: z.array(z.string()),
      series: z.array(z.looseObject({ name: z.string(), data: z.array(z.number()) })),
    })
    .optional(),
})

export type ForecastIndicatorIndexParsed = z.infer<typeof forecastIndicatorIndexSchema>

// ⑩ /plans CRUD 响应（嵌套复杂字段宽松化）
export const planSchema = z.looseObject({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  selectedKeys: z.array(z.string()),
  typeSettings: z.record(z.string(), z.unknown()),
  // savedXiaoqu 必须 optional：存量 plans.json 记录大多无此字段，必填会拒绝旧数据
  savedXiaoqu: z.array(z.unknown()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  businessType: z.string().optional(),
  waterLevel: z.number().optional(),
  totalLoss: z.number().optional(),
  floodRiskLevel: z.string().optional(),
})

export type PlanParsed = z.infer<typeof planSchema>

// ⑪ /flood/water-area 响应（[[lng,lat],...] 坐标数组）
export const waterAreaSchema = z.array(z.tuple([z.number(), z.number()]))

export type WaterAreaParsed = z.infer<typeof waterAreaSchema>

// ⑫ /flood/terrain-profiles 响应
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

// ⑬ /site-analysis 响应（GeoJSON 不深校验）
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

// ⑭ /flood/flood-areas 响应（features 元素为 GeoJSON Feature，由下游收窄）
export const floodAreasResponseSchema = z.looseObject({
  waterLevel: z.number(),
  requestedWaterLevel: z.number().optional(),
  actualWaterLevel: z.number().optional(),
  riskLevel: z.string(),
  features: z.array(z.unknown()),
})

export type FloodAreasResponseParsed = z.infer<typeof floodAreasResponseSchema>

// ⑮ /flood/flood-statistics 响应
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

// ⑯ /flood/analysis/disaster 响应（affectedFacilities 元素由下游收窄）
export const floodDisasterResponseSchema = z.looseObject({
  waterLevel: z.number(),
  requestedWaterLevel: z.number().optional(),
  riskLevel: z.string(),
  affectedFacilities: z.array(z.unknown()),
  totalLoss: z.number(),
})

export type FloodDisasterResponseParsed = z.infer<typeof floodDisasterResponseSchema>

// ⑰ /flood-online/api/flood/impact 响应（FastAPI 裸 JSON；affectedFacilities 元素由下游收窄）
export const floodImpactResponseSchema = z.looseObject({
  affectedFacilities: z.array(z.unknown()).optional(),
  totalLoss: z.number().optional(),
})

export type FloodImpactResponseParsed = z.infer<typeof floodImpactResponseSchema>

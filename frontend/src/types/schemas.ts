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

// ②a 淹没要素 / 受影响设施元素级 schema（D1：替代 z.array(z.unknown()) 浅校验 + as 硬转——
// geometry/coordinates 深字段在 HTTP 边界即把关，畸形数据抛 ApiError(REQUEST_FAILED) 而非穿透渲染）
export const floodGeometrySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('Polygon'),
    coordinates: z.array(z.array(z.array(z.number()))),
  }),
  z.object({
    type: z.literal('MultiPolygon'),
    coordinates: z.array(z.array(z.array(z.array(z.number())))),
  }),
])

export type FloodGeometryParsed = z.infer<typeof floodGeometrySchema>

export const floodFeatureSchema = z.object({
  type: z.literal('Feature'),
  geometry: floodGeometrySchema,
  // properties：riskLevel 业务必填（FloodFeature 契约，两数据源均在边界后注入——
  // api 模式由 controller 注入、online 模式由 floodAdapter 注入，见各自注释）；
  // 但原始响应边界不能强制必填：FastAPI flood_engine 仅返回 {area}（无 riskLevel），
  // 必填会把 online 模式全部判死（816-专项3-0816-06 回归，2026-08-17 修复），故 optional
  properties: z.looseObject({ riskLevel: z.string().optional() }),
})

export type FloodFeatureParsed = z.infer<typeof floodFeatureSchema>

export const affectedFacilitySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    lng: z.number(),
    lat: z.number(),
    port: z.string().optional(),
    loss: z.number(),
    damageRate: z.number(),
  })
  // passthrough：保留数据源附加字段（Express 侧 elevation/value），不剥除
  .passthrough()

export type AffectedFacilityParsed = z.infer<typeof affectedFacilitySchema>

// ③ /flood 在线演算响应（顶层字段严格校验，features 元素级深校验见 ⑭a）
export const floodOnlineResponseSchema = z.object({
  level: z.number(),
  featureCount: z.number(),
  floodedKm2: z.number(),
  features: z.array(floodFeatureSchema),
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
  // 816-专项3-0816-05：数据文件自带 confidence（berth.json 等），补可选字段防 schema 静默剥除
  confidence: z.number().optional(),
})

export type ForecastPointParsed = z.infer<typeof forecastPointSchema>

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
        // 816-专项3-0816-14：reliability 对齐 ForecastMapData 类型声明（原 schema 未枚举，looseObject 透传）
        reliability: z.number().optional(),
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
  // 816-专项3-0816-04：weights 由后端持久化（旧数据 null），前端声明但当前不消费
  weights: z.record(z.string(), z.number()).nullable().optional(),
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
  // 8-1：无重叠区域 = 合法空结果标记（02 §4.1），非错误信封
  empty: z.boolean().optional(),
  emptyReason: z.string().optional(),
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

// ⑭ /flood/flood-areas 响应（features 元素级深校验：floodFeatureSchema）
export const floodAreasResponseSchema = z.looseObject({
  waterLevel: z.number(),
  requestedWaterLevel: z.number().optional(),
  actualWaterLevel: z.number().optional(),
  riskLevel: z.string(),
  features: z.array(floodFeatureSchema),
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
  // 816-专项1 发现7（M5）：计数语义改名 affectedFacilityCount（原 affectedFacilities 与数组语义同名不同型）
  affectedFacilityCount: z.number().optional(),
  affectedPorts: z.array(z.string()).optional(),
  estimatedLoss: z.number().optional(),
  description: z.string().optional(),
  affectedCount: z.number().optional(),
})

export type FloodStatisticsResponseParsed = z.infer<typeof floodStatisticsResponseSchema>

// ⑯ /flood/analysis/disaster 响应（affectedFacilities 元素级深校验：affectedFacilitySchema）
export const floodDisasterResponseSchema = z.looseObject({
  waterLevel: z.number(),
  requestedWaterLevel: z.number().optional(),
  riskLevel: z.string(),
  affectedFacilities: z.array(affectedFacilitySchema),
  totalLoss: z.number(),
})

export type FloodDisasterResponseParsed = z.infer<typeof floodDisasterResponseSchema>

// ⑰ /flood-online/api/flood/impact 响应（FastAPI 裸 JSON；affectedFacilities 元素级深校验）
export const floodImpactResponseSchema = z.looseObject({
  affectedFacilities: z.array(affectedFacilitySchema).optional(),
  totalLoss: z.number().optional(),
})

export type FloodImpactResponseParsed = z.infer<typeof floodImpactResponseSchema>

// ⑱ 港口数据（前端静态 /data/ports.json，2026-08-29 自后端回迁；mapDataService 消费，C-4/6 补 schema）
export const portSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  lng: z.number(),
  lat: z.number(),
  type: z.string().optional(),
  phone: z.string().optional(),
})

export type PortParsed = z.infer<typeof portSchema>

export const portsArraySchema = z.array(portSchema)

export type PortsArrayParsed = z.infer<typeof portsArraySchema>

// ⑲ /api/favorites（全局收藏；同用户下 itemType + itemId 全局唯一，幂等添加）
export const favoriteItemSchema = z.object({
  id: z.string(),
  userId: z.string(),
  itemType: z.enum(['xiaoqu', 'facility']),
  itemId: z.string(),
  name: z.string(),
  lng: z.number(),
  lat: z.number(),
  snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  savedAt: z.string(),
})

export type FavoriteItemParsed = z.infer<typeof favoriteItemSchema>

export const favoritesArraySchema = z.array(favoriteItemSchema)

export const favoriteAddResponseSchema = z.object({
  favorite: favoriteItemSchema,
  existed: z.boolean(),
})

export const favoriteRemoveResponseSchema = z.object({
  removed: z.boolean(),
})

// ⑳ GET /route/path 响应（FastAPI 裸 JSON，envelope:false 直通）：判别 found 分成功/合法空两路。
// 不可达/未吸附是合法空结果（专项8 7.2 断链语义），不是错误。
export const routePathResponseSchema = z.discriminatedUnion('found', [
  z.object({
    found: z.literal(true),
    mode: z.enum(['distance', 'time']),
    distanceM: z.number(),
    durationMin: z.number(),
    snapDistanceM: z.object({ from: z.number(), to: z.number() }),
    edgeCount: z.number(),
    coordinates: z.array(z.tuple([z.number(), z.number()])),
  }),
  z.object({
    found: z.literal(false),
    reason: z.enum(['origin_not_snapped', 'destination_not_snapped', 'unreachable']),
  }),
])

export type RoutePathResponseParsed = z.infer<typeof routePathResponseSchema>

/**
 * z045: 外部数据边界 zod 运行时校验 schema 集中定义
 *
 * 设计原则：
 * - 与现有 `types/` 下的 interface 并存，不替换原有类型声明
 * - schema 用于外部数据边界（HTTP 响应、localStorage、sessionStorage、JSON.parse）的运行时校验
 * - 用 `z.infer<>` 导出类型供边界文件使用，原始 interface 仍为业务层主类型
 *
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
// z026: core 层（mapStore）不反向依赖业务 AnalysisResult，存储层用 Record<string, unknown>。
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

import type { Feature, Geometry } from 'geojson'
import type { FacilityType, TypeSetting } from './facility'
import type { ScoredXiaoqu } from './xiaoqu'

// 分析请求参数（前端 → 后端）
export interface AnalysisParams {
  selectedKeys: FacilityType[]
  typeSettings: Record<string, TypeSetting>
  weights?: Record<string, number>
}

// 分析结果（后端 → 前端）
// 注意：coverage 可能是 Polygon 或 MultiPolygon，turf.union 返回不确定
// 这里用 Feature<Geometry> 而不是 Feature<Polygon | MultiPolygon>
// 因为 turf 7 的 union 可能返回 GeometryCollection
export interface AnalysisResult {
  error: string | null
  coverage: Feature<Geometry> | null
  matchedXiaoqu: ScoredXiaoqu[]
  facilityPoi?: Record<string, import('./facility').FacilityPoint[]>
}

// 分析状态（前端组件内部使用）
export interface AnalysisState {
  calculating: boolean
  calcError: string
  result: AnalysisResult | null
}

// 重导出 FacilityPoint 方便引用
export type { FacilityPoint } from './facility'

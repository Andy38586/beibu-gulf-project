import type { Feature, Geometry } from 'geojson'

import type { FacilityType, TypeSetting } from './facility'
import type { ScoredXiaoqu } from './xiaoqu'

// 重新导出类型，方便其他模块引用
export type { FacilityType, TypeSetting } from './facility'
export type { ScoredXiaoqu } from './xiaoqu'

// 分析请求参数（前端 → 后端）
export interface AnalysisParams {
  selectedKeys: FacilityType[]
  typeSettings: Record<string, TypeSetting>
  weights?: Record<string, number>
}

// 分析结果（后端 → 前端）
// coverage 用 Feature<Geometry>：海岸线曲折，后端 turf.union 可能返回
// MultiPolygon 乃至 GeometryCollection，下游需做几何类型降级
export interface AnalysisResult {
  error: string | null
  // 8-1：无重叠区域 = 合法空结果标记（02 §4.1），非错误
  empty?: boolean
  emptyReason?: string
  coverage: Feature<Geometry> | null
  matchedXiaoqu: ScoredXiaoqu[]
  facilityPoi?: Record<string, import('./facility').FacilityPoint[]>
  selectedTypes?: string[]
}

// 分析状态（前端组件内部使用）
export interface AnalysisState {
  calculating: boolean
  calcError: string
  result: AnalysisResult | null
}

// 重导出 FacilityPoint 方便引用
export type { FacilityPoint } from './facility'

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
// coverage 类型放宽的地理背景：
// 北部湾海岸线曲折，turf.union 在输入多边形存在共享边界时可能返回 MultiPolygon；
// turf 7 的 union 甚至可能返回 GeometryCollection。
// 故用 Feature<Geometry> 而非 Feature<Polygon | MultiPolygon>，下游需做几何类型降级。
// 注：上述 turf 运算由后端 siteAnalysisService 完成，前端零 turf import，此注释仅记录后端经验。
export interface AnalysisResult {
  error: string | null
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

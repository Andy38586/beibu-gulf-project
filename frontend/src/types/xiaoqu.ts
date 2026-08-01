import type { FacilityType, TypeSetting } from './facility'

// 基础小区（来自 backend/data/site-selection/xiaoqu.json）
// 坐标系统：WGS84(EPSG:4326)，lng/lat 为地理经纬度
export interface Xiaoqu {
  id: string
  name: string
  lng: number
  lat: number
}

// 评分后的小区（分析结果，后端返回）
// score = ∑(facilityType 权重 × 衰减函数值)，详见 scoringService.js
export interface ScoredXiaoqu extends Xiaoqu {
  score: number
  breakdown: Record<string, number> // key 是 FacilityType，不强约束以避免后端 turf 计算报错（前端零 turf import）
  // 浸没分析扩展字段（受影响设施复用此类型，PaginatedListPanel 通用渲染）
  type?: string
  loss?: number
}

// 已保存的小区（方案中，持久化到 plans.json）
export interface SavedXiaoqu extends ScoredXiaoqu {
  savedAt: string
  selectionCriteria?: {
    selectedTypes: FacilityType[]
    typeSettings: Record<string, TypeSetting>
  }
}

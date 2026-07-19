import type { FacilityType, TypeSetting } from './facility'

// 基础小区（来自 server/data/xiaoqu.json）
export interface Xiaoqu {
  id: string
  name: string
  lng: number
  lat: number
}

// 评分后的小区（分析结果，后端返回）
export interface ScoredXiaoqu extends Xiaoqu {
  score: number
  breakdown: Record<string, number> // key 是 FacilityType，但不强约束避免 turf 计算报错
}

// 已保存的小区（方案中，持久化到 plans.json）
export interface SavedXiaoqu extends ScoredXiaoqu {
  savedAt: string
  selectionCriteria?: {
    selectedTypes: FacilityType[]
    typeSettings: Record<string, TypeSetting>
  }
}

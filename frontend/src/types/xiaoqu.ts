import type { FacilityType, TypeSetting } from './facility'

// 基础小区（POI/小区数据源，随旧版选址域归档）
// 坐标系统：WGS84(EPSG:4326)，lng/lat 为地理经纬度
interface Xiaoqu {
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
  loss?: number // 损失（万元，value × damageRate；facilityPoints metadata.valueUnit 口径）
}

// 已保存的小区（方案中；持久化在 PostgreSQL 的 plans 域，非 JSON 文件）
export interface SavedXiaoqu extends ScoredXiaoqu {
  savedAt: string
  selectionCriteria?: {
    selectedTypes: FacilityType[]
    typeSettings: Record<string, TypeSetting>
  }
}

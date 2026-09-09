// 选址分析领域类型：设施点与设施类型设置。
// 独立于评分算法（services/scoring）——controller / repository / service 共用同一形状，
// 避免数据访问层反向依赖服务层。
export interface FacilityPoint {
  id?: string
  name?: string
  lng: number
  lat: number
  [key: string]: unknown
}

export interface TypeSetting {
  selected?: boolean
  defaultRadius?: number
  radius?: number
  importance?: number
  [key: string]: unknown
}

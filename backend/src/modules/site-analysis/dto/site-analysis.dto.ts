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

// 关键词搜索结果项（航线分析选点用；坐标 4326 由 SQL ST_Transform 出）
// source = 来源点集（port/facility/xiaoqu/poi）——多源合并后前端按来源显示标签
export interface PoiSearchItem {
  id: string
  name: string
  type: string
  source: string
  city: string
  district: string | null
  lng: number
  lat: number
}

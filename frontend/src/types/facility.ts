// 设施类型枚举（6种，与后端 server/data/qz_*.json 文件一一对应）
// 选址分析因子体系：医疗、教育、交通、商业、休闲五类配套
export type FacilityType =
  | 'hospital'
  | 'primary_school'
  | 'middle_school'
  | 'park'
  | 'bus_station'
  | 'mall'

// 设施配置（来自 useFacilities.js 的 FACILITY_CONFIG）
export interface FacilityConfig {
  label: string
  color: string
  defaultRadius: number // 缓冲半径（米），后端 siteAnalysisService 用 turf.buffer 计算
}

// 设施点（POI，来自 server/data/qz_*.json）
// 坐标系统：WGS84(EPSG:4326)，lng/lat 为地理经纬度
export interface FacilityPoint {
  id?: string
  name: string
  lng: number
  lat: number
}

// 设施类型设置（因子面板中每个设施的状态）
// importance 影响缓冲半径与评分权重（见 importanceMapping.js）
export interface TypeSetting {
  selected: boolean
  importance: number
  defaultRadius: number
  radius?: number
}

// 设施配置映射
export type FacilityConfigMap = Record<FacilityType, FacilityConfig>

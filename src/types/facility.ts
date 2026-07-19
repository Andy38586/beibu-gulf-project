// 设施类型枚举（6种，与后端 server/data/ 下的文件一一对应）
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
  defaultRadius: number
}

// 设施点（POI，来自 server/data/qz_*.json）
export interface FacilityPoint {
  id?: string
  name: string
  lng: number
  lat: number
}

// 设施类型设置（因子面板中每个设施的状态）
export interface TypeSetting {
  selected: boolean
  importance: number
  defaultRadius: number
  radius?: number
}

// 设施配置映射
export type FacilityConfigMap = Record<FacilityType, FacilityConfig>

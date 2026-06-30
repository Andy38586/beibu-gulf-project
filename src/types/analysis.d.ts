export interface FacilityConfig {
  label: string
  color: string
  defaultRadius: number
}

export interface TypeSetting {
  selected: boolean
  importance: number
  defaultRadius: number
  radius?: number
}

export interface Xiaoqu {
  id: string
  name: string
  lng: number
  lat: number
  score?: number
  breakdown?: Record<string, number>
}

export interface AnalysisResult {
  coverage: GeoJSON.Feature | null
  matchedXiaoqu: Xiaoqu[]
  selectedTypes: string[]
}

export interface AnalysisParams {
  selectedKeys: string[]
  typeSettings: Record<string, TypeSetting>
  weights?: Record<string, number>
}

export interface AnalysisApiState {
  calculating: boolean
  calcError: string
}

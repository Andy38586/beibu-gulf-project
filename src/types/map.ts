// 港口（来自 public/data/ports.json）
// 注意：港口数据用的是 lon，不是 lng（历史数据问题）
export interface Port {
  id: string
  name: string
  address: string
  lon: number
  lat: number
  description?: string
}

// 图层条目（map store 的 layerCatalog 元素）
export interface LayerEntry {
  key: string
  label: string
  visible: boolean
  category: 'base' | 'business'
  show: Array<() => void>
  hide: Array<() => void>
}

// 面板名称
export type PanelName = 'none' | 'port-info' | 'xiaoqu-detail' | string

// 地图类型
export type MapType = '2d' | '3d'

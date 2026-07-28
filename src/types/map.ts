// 港口（来自 public/data/ports.json）
// 已统一使用 lng/lat 命名规范（规范 3.1）
export interface Port {
  id: string
  name: string
  address: string
  lng: number
  lat: number
  description?: string
}

// 图层条目（map store 的 layerCatalog 元素）
// 两种形态：
//   1. registerLayer/registerToggleable: 含 show/hide 回调
//   2. registerBusinessLayer: 含 layerType，无 show/hide
export interface LayerEntry {
  key: string
  label: string
  visible: boolean
  category: 'base' | 'business'
  show?: Array<() => void>
  hide?: Array<() => void>
  layerType?: string
}

/** registerLayer 选项 */
export interface RegisterLayerOptions {
  visible?: boolean
  category?: 'base' | 'business'
  show?: () => void
  hide?: () => void
}

/** registerToggleable 参数（show 可以是渲染器或函数） */
export type ToggleableHandler =
  | (() => void)
  | { setVisibility: (_id: string, _visible: boolean) => void }

// 面板名称
export type PanelName = 'none' | 'port-info' | 'xiaoqu-detail' | string

// 地图类型
export type MapType = '2d' | '3d'

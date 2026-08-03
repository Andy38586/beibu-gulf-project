// 港口（来自 backend/data/ports.json，经 GET /api/ports 返回）
// 已统一使用 lng/lat 命名规范（规范 3.1）
export interface Port {
  id: string
  name: string
  address: string
  lng: number
  lat: number
  description?: string
}

import type { LayerType } from '@/types/core/layerManager'

// 图层条目（map store 的 layerCatalog 元素）
// 两种形态：
// 1. registerLayer/registerToggleable: 含 show/hide 回调
// 2. registerBusinessLayer: 含 layerType，无 show/hide
export interface LayerEntry {
  key: string
  label: string
  visible: boolean
  category: 'base' | 'business'
  show?: Array<() => void>
  hide?: Array<() => void>
  layerType?: LayerType
}

/**
 * registerLayer 选项
 * show/hide 声明为数组，与 LayerEntry.show/hide 形状一致。
 * registerBaseLayer / registerToggleable 仍接受单个函数，在内部包装为数组后传入；
 * registerLayer 直接存储数组，不再二次包装（避免 (() => void)[][] 双重数组）。
 */
export interface RegisterLayerOptions {
  visible?: boolean
  category?: 'base' | 'business'
  show?: Array<() => void>
  hide?: Array<() => void>
}

/** registerToggleable 参数（show 可以是渲染器或函数） */
export type ToggleableHandler =
  | (() => void)
  | { setVisibility: (_id: string, _visible: boolean) => void }

// 面板名称
// 使用 (string & {}) 而非裸 string，保留字面量收窄与 IDE 自动补全
// 参考 types/api/forecast.ts 中 ForecastIndicatorName 的同类写法
export type PanelName = 'none' | 'port-info' | 'xiaoqu-detail' | (string & {})

// 地图类型
export type MapType = '2d' | '3d'

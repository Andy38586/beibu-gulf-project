// 港口（来自 backend/data/ports.json，经 GET /api/ports 返回；统一 lng/lat 命名）
export interface Port {
  id: string
  name: string
  address: string
  lng: number
  lat: number
  /** 港口类型（ports.json 字段,如"客运港"） */
  type?: string
  /** 联系电话（ports.json 字段） */
  phone?: string
}

import type { LayerType } from '@/types/core/layerManager'

// 图层目录（layerCatalog）条目——仅存元数据，显隐由 BusinessLayerManager 驱动
export interface LayerEntry {
  key: string
  label: string
  visible: boolean
  category: 'base' | 'business'
  layerType?: LayerType
}

// 面板名称（(string & {}) 保留字面量收窄与 IDE 补全）
export type PanelName = 'none' | 'port-info' | 'xiaoqu-detail' | (string & {})

// 地图类型
export type MapType = '2d' | '3d'

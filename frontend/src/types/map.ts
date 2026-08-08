// 港口（来自 backend/data/ports.json，经 GET /api/ports 返回）
// 已统一使用 lng/lat 命名规范（规范 3.1）
// P1-b: 补齐 type/phone 字段（PortInfoPanel 已在消费,原类型缺口;删除虚挂的 description——
// ports.json 实际无该字段）
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

// 图层条目（map store 的 layerCatalog 元素）
// P6：show/hide 回调机制已删（registerLayer/registerToggleable 移除）——
// 图层显隐统一由 BusinessLayerManager.setVisible 驱动，条目仅存元数据
export interface LayerEntry {
  key: string
  label: string
  visible: boolean
  category: 'base' | 'business'
  layerType?: LayerType
}

// 面板名称
// 使用 (string & {}) 而非裸 string，保留字面量收窄与 IDE 自动补全
// 参考 types/api/forecast.ts 中 ForecastIndicatorName 的同类写法
export type PanelName = 'none' | 'port-info' | 'xiaoqu-detail' | (string & {})

// 地图类型
export type MapType = '2d' | '3d'

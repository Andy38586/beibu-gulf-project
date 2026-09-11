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
/** 渲染引擎标识（registry 标记图层适用引擎，面板徽标与 reapplyAll 过滤共用） */
export type EngineName = 'openlayers' | 'cesium'

/**
 * 引擎标识常量（09-11 收口）：EngineName 的字面量此前散落在 mapStore / layerAdapters /
 * BusinessLayerManager / LayerControlPanel 共 6 处裸写，其中 3 处无类型约束（拼错不报错）。
 * 有类型标注处由 TS 兜底，无标注处统一从本常量取。
 */
export const ENGINE_NAMES = { OPENLAYERS: 'openlayers', CESIUM: 'cesium' } as const

/** 缺省引擎集（registry meta 与目录镜像均无标记时视为双引擎通用，与 LayerEntry.engines 缺省语义一致） */
export const DEFAULT_ENGINES: EngineName[] = [ENGINE_NAMES.OPENLAYERS, ENGINE_NAMES.CESIUM]

/** 引擎徽标文案（图层控制面板 DEV 标号；与应用层 UI 文案解耦） */
export const ENGINE_LABELS: Record<EngineName, string> = {
  openlayers: 'OL',
  cesium: 'CS',
}

export interface LayerEntry {
  key: string
  label: string
  visible: boolean
  category: 'base' | 'business'
  layerType?: LayerType
  /** 适用引擎（缺省视为 openlayers+cesium 双引擎通用） */
  engines?: EngineName[]
}

// 面板名称（(string & {}) 保留字面量收窄与 IDE 补全）
export type PanelName = 'none' | 'port-info' | 'xiaoqu-detail' | (string & {})

// 地图类型
export type MapType = '2d' | '3d'

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
  /**
   * 是否在图层面板中列出（缺省 true）。
   *
   * 为 false 时图层**仍然注册在 BusinessLayerManager 里**（registry 依旧是可见性的
   * 唯一权威源、引擎切换仍由 reapplyAll 重绘），只是不作为按钮呈现在面板上。
   * 用于「随底图默认加载、不交给用户开关」的基础能力层，例如地形山影。
   *
   * 与 locked 正交：listed=false 只影响呈现，不改变可操作性（面板本就没入口）。
   */
  listed?: boolean
  /**
   * 可见性是否被锁定（缺省 false）。
   *
   * 为 true 时 `setVisible(key, false)` 被拒——该图层是基础能力的一部分，只能随
   * 渲染器生命周期存在/消失，不允许被任何调用方（含面板、含业务页）关掉。
   * 用途同 listed：地形 z 起伏与山影这类「底图固有」的层，关掉它们只会让地图
   * 变成半成品，不构成有效操作。
   */
  locked?: boolean
}

// 面板名称（(string & {}) 保留字面量收窄与 IDE 补全）
export type PanelName = 'none' | 'port-info' | 'xiaoqu-detail' | (string & {})

// 地图类型
export type MapType = '2d' | '3d'

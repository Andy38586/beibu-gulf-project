/**
 * BusinessLayerManager 强类型元数据（types/core/layerManager.ts）
 *
 * ── D2 决策 ──
 * LayerMeta 复用【已有的】LayerOptions（定义于 @/types/renderer），
 * 不另起一套样式类型；data 保持 unknown，由具体 adapter 内部按业务契约收窄。
 *
 * LayerType 从 BusinessLayerManager.js 注释里的字符串字面量
 * 提升为正式联合类型，与 LAYER_ADAPTERS 注册表的 key 对齐。
 * （这是"把散落的业务约束收口成类型"的典型动作。）
 */

import type { LayerOptions } from '@/types/renderer'

/**
 * 业务图层类型，对应 LAYER_ADAPTERS 注册表的 key。
 * 改这里 = 改图层能力清单，渲染器侧需同步实现对应 adapter。
 */
export type LayerType = 'heatmap' | 'geojson' | 'points' | 'polygon' | 'waterSurface' | 'geotiff'

/**
 * 业务图层元数据 —— BusinessLayerManager._registry 的条目形状。
 *
 * 注意：当前 .js 版本的 register() 实际只存了 { layerType, options }，
 * 没有持久化 data（data 仅在注册时立即渲染）。TS 化时补上 data/label/visible，
 * 让元数据完整、可被 updateData / getMeta 复用，而不必每次从 renderer 反查。
 */
export interface LayerMeta {
  /** 图层唯一键（业务模块约定，如 "forecast-throughput"） */
  key: string
  /** LayerControlPanel 显示名 */
  label: string
  /** 图层类型，决定分派到哪个 adapter */
  layerType: LayerType
  /** 样式参数 —— 直接复用渲染器 LayerOptions */
  options: LayerOptions
  /**
   * 业务数据负载。
   * 故意保持 unknown：形状取决于 layerType，由对应 adapter 内部收窄。
   * 这正是"数据流类型"的边界——Manager 只搬运，不解读具体业务形状。
   * 若某 layerType 需要更强约束，应在 adapter 入参处收窄，而非在此放宽。
   */
  data: unknown
  /** 初始 / 当前可见性 */
  visible: boolean
}

/**
 * 若未来某个 layerType 需要比 LayerOptions 更丰富的样式，
 * 正确做法是扩展 @/types/renderer 的 LayerOptions（加可选字段），
 * 而不是在 LayerMeta 旁边另起一套——避免类型漂移。
 */

/**
 * 水面图层数据载荷（3D Only，waterSurface adapter 入参）。
 *
 * 从 layerAdapters.ts 提升为共享类型（TS-3）：消除 adapter 内部重复声明，
 * 让"水面数据形状"成为单一事实来源，业务层构造 payload 时也能复用本类型。
 */
export interface WaterSurfaceData {
  /** 水面边界多边形坐标环（[lng, lat][]） */
  coordinates: [number, number][]
  /** 水面高程（米） */
  height: number
}

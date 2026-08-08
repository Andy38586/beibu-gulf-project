import { defineStore } from 'pinia'
import type { Ref, ShallowRef } from 'vue'
import { ref, shallowRef } from 'vue'

import { logger } from '@/shared'
import type { LayerEntry, LayerType, MapType, Port } from '@/types'
import type { MapRenderer } from '@/types'
import { analysisResultSchema } from '@/types/schemas'

/** localStorage 键：底图；sessionStorage：分析结果 */
const BASE_LAYER_STORAGE_KEY = 'beibu-gulf-base-layer'
const ANALYSIS_RESULT_STORAGE_KEY = 'beibu-gulf-analysis-result'
// 分析结果持久化版本号——schema 变化时升版，旧版本数据自动丢弃避免污染新结构
const ANALYSIS_RESULT_VERSION = 1

function readStoredBaseLayer(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(BASE_LAYER_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredBaseLayer(key: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (key) {
      window.localStorage.setItem(BASE_LAYER_STORAGE_KEY, key)
    }
  } catch {
    // 忽略隐私模式等写入失败场景
  }
}

/** z026: 收窄为结构化类型（core 层不反向依赖业务 AnalysisResult，业务层读取时自行 cast）
 * 版本校验后用 analysisResultSchema.safeParse 替代 `as Record<string, unknown>` 断言 */
function readStoredAnalysisResult(): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.sessionStorage.getItem(ANALYSIS_RESULT_STORAGE_KEY)
    if (!stored) return null
    const parsed = JSON.parse(stored)
    // 版本校验——旧格式（无 version）或无 data 字段一律丢弃
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed.version !== ANALYSIS_RESULT_VERSION ||
      !('data' in parsed)
    ) {
      window.sessionStorage.removeItem(ANALYSIS_RESULT_STORAGE_KEY)
      return null
    }
    // safeParse 替代 `parsed.data as Record<string, unknown>`
    const result = analysisResultSchema.safeParse(parsed.data)
    if (!result.success) {
      logger.warn('[mapStore] 分析结果数据校验失败，已清除:', result.error.issues)
      window.sessionStorage.removeItem(ANALYSIS_RESULT_STORAGE_KEY)
      return null
    }
    return result.data
  } catch {
    return null
  }
}

function writeStoredAnalysisResult(result: Record<string, unknown> | null): void {
  if (typeof window === 'undefined') return
  try {
    if (result) {
      // 包装 { version, data }，配合读取端版本校验
      window.sessionStorage.setItem(
        ANALYSIS_RESULT_STORAGE_KEY,
        JSON.stringify({ version: ANALYSIS_RESULT_VERSION, data: result })
      )
    } else {
      window.sessionStorage.removeItem(ANALYSIS_RESULT_STORAGE_KEY)
    }
  } catch {
    // 忽略隐私模式等写入失败场景
  }
}

export const useMapStore = defineStore('map', () => {
  // map 存储地图引擎实例（OL Map / Cesium Viewer），非渲染器，用 unknown 避免误用
  const map: ShallowRef<unknown> = shallowRef(null)
  const selectedPort: Ref<Port | null> = ref(null)
  const mapType: Ref<MapType> = ref('2d')
  // shallowRef：layerCatalog 是元数据数组，内部条目变更由各 action 触发
  // 不需要深度代理每个 LayerEntry 对象，避免 50 个图层注册触发 50 次深度响应式追踪
  const layerCatalog: ShallowRef<LayerEntry[]> = shallowRef([])
  const baseLayerKey: Ref<string | null> = ref(readStoredBaseLayer())

  /** 当前渲染器引用（由UnifiedMap设置，供业务组件访问） */
  const currentRenderer: ShallowRef<MapRenderer | null> = shallowRef(null)

  // 从 sessionStorage 恢复分析结果（收窄为 Record，业务层自行 cast）
  const lastAnalysisResult: Ref<Record<string, unknown> | null> = ref(readStoredAnalysisResult())

  function setMap(instance: unknown): void {
    map.value = instance
  }

  // 由 UnifiedMap 在渲染器初始化/切换时调用
  function setCurrentRenderer(renderer: MapRenderer | null): void {
    currentRenderer.value = renderer
  }

  // 地图类型仅内存态（DAT-5：原 localStorage 写入为无读取方的死写入，已移除）；
  // 刷新后回退默认 '2d'，与改动前行为一致，无回归。
  function setMapType(type: MapType): void {
    mapType.value = type
  }

  function setSelectedPort(port: Port | null): void {
    selectedPort.value = port
  }

  function clearSelectedPort(): void {
    selectedPort.value = null
  }

  // 2026-08-08：mapStore 不再持有分析回调（analysisHandler/registerAnalysisHandler/回放已删）——
  // 回调由选址页自持（createUpdateHandler 直连），store 只负责结果数据的会话持久化。
  function setAnalysisResult(result: Record<string, unknown>): void {
    lastAnalysisResult.value = result
    // 持久化分析结果到 sessionStorage
    writeStoredAnalysisResult(result)
  }

  /**
   * 注册底图条目（P6：旧回调版已删——底图切换统一走 setBaseLayer + baseLayerKey）。
   * 幂等：UnifiedMap.setupLayers 每次引擎切换都调，已存在则跳过。
   */
  function registerBaseLayer(key: string, label: string): void {
    const existing = layerCatalog.value.find((e: LayerEntry) => e.key === key)
    if (existing) return
    const isFirstBase = layerCatalog.value.every((e: LayerEntry) => e.category !== 'base')
    // 优先以 localStorage 持久化的底图 key 为准；未设置时默认第一个底图可见
    const storedKey = baseLayerKey.value
    const visible = storedKey ? key === storedKey : isFirstBase
    layerCatalog.value = [...layerCatalog.value, { key, label, visible, category: 'base' }]
  }

  /**
   * 注册业务图层到 layerCatalog
   * 与 registerToggleable 不同：
   * - 不存储 show/hide 回调函数
   * - 不触发 toggle，直接设 visible
   * - catalog 条目只有元数据（key/label/layerType/visible/category）
   * - LayerControlPanel 只读此条目，不做渲染操作
   */
  function registerBusinessLayer(
    key: string,
    label: string,
    layerType: LayerType,
    visible: boolean = true
  ): void {
    const existing = layerCatalog.value.find((e: LayerEntry) => e.key === key)
    if (existing) {
      // 已存在：更新可见性与 layerType（不可变更新，配合 shallowRef）
      layerCatalog.value = layerCatalog.value.map((e: LayerEntry) =>
        e.key === key ? { ...e, visible, layerType } : e
      )
      return
    }
    const newEntry: LayerEntry = {
      key,
      label,
      layerType,
      visible,
      category: 'business',
    }
    layerCatalog.value = [...layerCatalog.value, newEntry]
  }

  /**
   * 切换当前底图（P6：互斥选择——同一时刻仅一个底图可见）。
   * 取代旧 toggleLayer 底图分支（show/hide 回调机制已删，registerToggleable 已删）。
   * 权威源：baseLayerKey（localStorage 持久化）；catalog base 条目 visible 同步镜像。
   * LayerControlPanel 底图按钮直接调用此 action。
   */
  function setBaseLayer(key: string): void {
    const entry = layerCatalog.value.find((e: LayerEntry) => e.key === key)
    if (!entry || entry.category !== 'base') return
    if (baseLayerKey.value === key && entry.visible) return // 已是当前底图

    // 互斥更新 catalog（base 条目只保留一个 visible，不可变更新配合 shallowRef）
    layerCatalog.value = layerCatalog.value.map((e: LayerEntry) => {
      if (e.category !== 'base') return e
      return { ...e, visible: e.key === key }
    })

    baseLayerKey.value = key
    writeStoredBaseLayer(key)

    // 当前渲染器切换底图引擎（OLRenderer/CesiumRenderer 均有 setBaseLayer('image'|'vector')）
    const renderer = currentRenderer.value as
      | (MapRenderer & { setBaseLayer?: (type: string) => void })
      | null
    renderer?.setBaseLayer?.(key === 'base-image' ? 'image' : 'vector')
  }

  function removeLayer(key: string): void {
    const idx = layerCatalog.value.findIndex((e: LayerEntry) => e.key === key)
    if (idx < 0) return
    // P6：旧机制 show/hide 回调已删（registerToggleable/registerLayer 移除），
    // 显隐统一由 BusinessLayerManager.setVisible 驱动——此处仅删条目
    // 不可变删除（配合 shallowRef）
    layerCatalog.value = layerCatalog.value.filter((_, i) => i !== idx)
  }

  function clearLayerCatalog(): void {
    layerCatalog.value = []
  }

  /**
   * 设置图层可见性（通过 action 修改，确保 Pinia 正确追踪）
   * BusinessLayerManager.setVisible 调用此方法，
   * 不直接修改 catalogEntry.visible（绕过 action 会导致 reactivity 不追踪、
   * Pinia DevTools 无 action 记录）。
   * 不可变更新（配合 shallowRef）：返回新数组引用以触发响应式。
   * @param key - 图层 key
   * @param visible - 可见性
   */
  function setLayerVisible(key: string, visible: boolean): void {
    const idx = layerCatalog.value.findIndex((e: LayerEntry) => e.key === key)
    if (idx < 0) {
      logger.debug(`setLayerVisible: 未找到key为“${key}”的图层`)
      return
    }
    layerCatalog.value = layerCatalog.value.map((e: LayerEntry) =>
      e.key === key ? { ...e, visible } : e
    )
  }

  /**
   * 统一重置地图业务交互状态（登出/业务切换时调用）
   * 设计边界（@arch-note）：
   * - 清：selectedPort / lastAnalysisResult
   * （含 sessionStorage 持久化，b035 要求）/ layerCatalog 业务条目（保留 base 底图条目）
   * - 保留：mapType / baseLayerKey（用户偏好，审计明确要求保留）
   * - 保留：currentRenderer / map —— 渲染器由 UnifiedMap 组件持有生命周期，
   * 登出时组件未卸载，清空会造成 BLM._getRenderer() 返回 null 与业务图层失效；
   * layerCatalog base 底图条目由 UnifiedMap.setupLayers 在引擎切换时重建，登出无切换，
   * 保留 base 条目避免 LayerControlPanel 底图区域永久空白。
   */
  function resetMapState(): void {
    selectedPort.value = null
    // 仅清业务条目，保留 base 底图条目（最小影响）
    layerCatalog.value = layerCatalog.value.filter((e: LayerEntry) => e.category !== 'business')
    lastAnalysisResult.value = null
    try {
      window.sessionStorage.removeItem(ANALYSIS_RESULT_STORAGE_KEY)
    } catch {
      // 隐私模式等写入失败场景
    }
  }

  return {
    map,
    mapType,
    selectedPort,
    layerCatalog,
    baseLayerKey,
    currentRenderer,
    lastAnalysisResult,
    setMap,
    setCurrentRenderer,
    setMapType,
    setSelectedPort,
    clearSelectedPort,
    setAnalysisResult,
    registerBaseLayer,
    registerBusinessLayer,
    setBaseLayer,
    removeLayer,
    clearLayerCatalog,
    setLayerVisible,
    resetMapState,
  }
})

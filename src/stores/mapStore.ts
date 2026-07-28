import { defineStore } from 'pinia'
import { shallowRef, ref } from 'vue'
import type { Ref, ShallowRef } from 'vue'
import type { Port, MapType, LayerEntry, RegisterLayerOptions } from '@/types'
import type { MapRenderer } from '@/types'
import type { ScoredXiaoqu } from '@/types'

/** localStorage 键：底图、地图类型、选中港口；sessionStorage：分析结果 */
const BASE_LAYER_STORAGE_KEY = 'beibu-gulf-base-layer'
const MAP_TYPE_STORAGE_KEY = 'beibu-gulf-map-type'
const SELECTED_PORT_STORAGE_KEY = 'beibu-gulf-selected-port'
const ANALYSIS_RESULT_STORAGE_KEY = 'beibu-gulf-analysis-result'

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

function writeStoredMapType(type: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(MAP_TYPE_STORAGE_KEY, type)
  } catch {
    // 忽略隐私模式等写入失败场景
  }
}

function writeStoredSelectedPort(port: Port | null): void {
  if (typeof window === 'undefined') return
  try {
    if (port) {
      window.localStorage.setItem(SELECTED_PORT_STORAGE_KEY, JSON.stringify(port))
    } else {
      window.localStorage.removeItem(SELECTED_PORT_STORAGE_KEY)
    }
  } catch {
    // 忽略隐私模式等写入失败场景
  }
}

function readStoredAnalysisResult(): unknown {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.sessionStorage.getItem(ANALYSIS_RESULT_STORAGE_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

function writeStoredAnalysisResult(result: unknown): void {
  if (typeof window === 'undefined') return
  try {
    if (result) {
      window.sessionStorage.setItem(ANALYSIS_RESULT_STORAGE_KEY, JSON.stringify(result))
    } else {
      window.sessionStorage.removeItem(ANALYSIS_RESULT_STORAGE_KEY)
    }
  } catch {
    // 忽略隐私模式等写入失败场景
  }
}

export const useMapStore = defineStore('map', () => {
  const map: ShallowRef<MapRenderer | null> = shallowRef(null)
  const selectedPort: Ref<Port | null> = ref(null)
  const mapType: Ref<MapType> = ref('2d')
  const layerCatalog: Ref<LayerEntry[]> = ref([])
  const baseLayerKey: Ref<string | null> = ref(readStoredBaseLayer())

  /** 当前渲染器引用（由UnifiedMap设置，供业务组件访问） */
  const currentRenderer: ShallowRef<MapRenderer | null> = shallowRef(null)

  const analysisHandler: Ref<((_result: unknown) => void) | null> = ref(null)
  // 从 sessionStorage 恢复分析结果
  const lastAnalysisResult: Ref<unknown> = ref(readStoredAnalysisResult())

  const activePanel: Ref<string> = ref('none')
  const selectedXiaoqu: Ref<ScoredXiaoqu | null> = ref(null)

  function setMap(instance: MapRenderer | null): void {
    map.value = instance
  }

  // 由 UnifiedMap 在渲染器初始化/切换时调用
  function setCurrentRenderer(renderer: MapRenderer | null): void {
    currentRenderer.value = renderer
  }

  // 删除重复函数，保留 setMapType
  // 持久化地图类型
  function setMapType(type: MapType): void {
    mapType.value = type
    writeStoredMapType(type)
  }

  function setSelectedPort(port: Port | null): void {
    selectedPort.value = port
    writeStoredSelectedPort(port)
  }

  function clearSelectedPort(): void {
    selectedPort.value = null
    writeStoredSelectedPort(null)
  }

  function registerAnalysisHandler(handler: (_result: unknown) => void): void {
    // 验证handler是否为函数
    if (typeof handler !== 'function') {
      if (import.meta.env.DEV) {
        console.warn('registerAnalysisHandler: handler必须是函数类型')
      }
      return
    }
    analysisHandler.value = handler
    if (lastAnalysisResult.value) {
      handler(lastAnalysisResult.value)
    }
  }

  function setAnalysisResult(result: unknown): void {
    lastAnalysisResult.value = result
    // 持久化分析结果到 sessionStorage
    writeStoredAnalysisResult(result)
    // 验证 analysisHandler 是否为函数
    if (typeof analysisHandler.value === 'function') {
      analysisHandler.value(result)
    }
  }

  function registerLayer(key: string, label: string, options: RegisterLayerOptions): void {
    const { visible = false, category = 'business', show, hide } = options

    const existingIndex = layerCatalog.value.findIndex((e: LayerEntry) => e.key === key)
    if (existingIndex >= 0) {
      const existing = layerCatalog.value[existingIndex]
      if (show) existing.show!.push(show)
      if (hide) existing.hide!.push(hide)
    } else {
      layerCatalog.value.push({
        key,
        label,
        visible,
        category,
        show: show ? [show] : [() => {}],
        hide: hide ? [hide] : [() => {}],
      })
    }
  }

  function registerBaseLayer(key: string, label: string, show: () => void, hide: () => void): void {
    const existing = layerCatalog.value.find((e: LayerEntry) => e.key === key)
    const isFirstBase = layerCatalog.value.every((e: LayerEntry) => e.category !== 'base')
    // 优先以 localStorage 中持久化的底图 key 为准；未设置时默认第一个底图可见
    const storedKey = baseLayerKey.value
    const shouldVisible = existing ? existing.visible : storedKey ? key === storedKey : isFirstBase

    const wrappedShow = () => {
      layerCatalog.value
        .filter((e: LayerEntry) => e.category === 'base' && e.key !== key)
        .forEach((e: LayerEntry) => {
          e.visible = false
          e.hide!.forEach((fn) => fn())
        })
      baseLayerKey.value = key
      writeStoredBaseLayer(key)
      show()
    }

    registerLayer(key, label, {
      visible: shouldVisible,
      category: 'base',
      show: wrappedShow,
      hide,
    })

    if (shouldVisible) {
      wrappedShow()
    }
  }

  function registerToggleable(
    key: string,
    label: string,
    showOrRenderer: (() => void) | { setVisibility: (_id: string, _visible: boolean) => void },
    hide: (() => void) | undefined,
    visible: boolean = true
  ): void {
    const existing = layerCatalog.value.find((e: LayerEntry) => e.key === key)
    const shouldVisible = existing ? existing.visible : visible

    // 兼容：showOrRenderer 可能是渲染器对象或函数
    const showFn: () => void =
      typeof showOrRenderer === 'function'
        ? showOrRenderer
        : () => showOrRenderer.setVisibility(key, true)

    const hideFn: (() => void) | undefined = hide
      ? hide
      : typeof showOrRenderer !== 'function' && 'setVisibility' in showOrRenderer
        ? () => showOrRenderer.setVisibility(key, false)
        : undefined

    registerLayer(key, label, {
      visible: shouldVisible,
      category: 'business',
      show: showFn,
      hide: hideFn,
    })

    if (shouldVisible) {
      showFn()
    }
  }

  /**
   * 注册业务图层到 layerCatalog
   *
   * 与 registerToggleable 不同：
   * - 不存储 show/hide 回调函数
   * - 不触发 toggle，直接设 visible
   * - catalog 条目只有元数据（key/label/layerType/visible/category）
   * - LayerControlPanel 只读此条目，不做渲染操作
   */
  function registerBusinessLayer(
    key: string,
    label: string,
    layerType: string,
    visible: boolean = true
  ): void {
    const existing = layerCatalog.value.find((e: LayerEntry) => e.key === key)
    if (existing) {
      existing.visible = visible
      existing.layerType = layerType
      return
    }
    layerCatalog.value.push({
      key,
      label,
      layerType,
      visible,
      category: 'business',
    })
  }

  function toggleLayer(key: string): void {
    const entry = layerCatalog.value.find((e: LayerEntry) => e.key === key)
    // 验证entry存在性
    if (!entry) {
      if (import.meta.env.DEV) {
        console.warn(`toggleLayer: 未找到key为"${key}"的图层`)
      }
      return
    }

    if (entry.category === 'base') {
      handleBaseLayerToggle(entry)
    } else {
      handleBusinessLayerToggle(entry)
    }
  }

  function handleBaseLayerToggle(entry: LayerEntry): void {
    if (entry.visible) {
      // 底图必须保留一个可见，避免地图无背景
      return
    }

    layerCatalog.value
      .filter((e: LayerEntry) => e.category === 'base')
      .forEach((e: LayerEntry) => {
        e.visible = false
        e.hide!.forEach((fn) => fn())
      })

    entry.visible = true
    baseLayerKey.value = entry.key
    writeStoredBaseLayer(entry.key)
    entry.show!.forEach((fn) => fn())
  }

  function handleBusinessLayerToggle(entry: LayerEntry): void {
    entry.visible = !entry.visible

    if (entry.visible) {
      entry.show!.forEach((fn) => fn())
    } else {
      entry.hide!.forEach((fn) => fn())
    }
  }

  function removeLayer(key: string): void {
    const idx = layerCatalog.value.findIndex((e: LayerEntry) => e.key === key)
    if (idx < 0) return
    const entry = layerCatalog.value[idx]
    // 旧机制图层（registerToggleable）有 show/hide 回调，新机制（registerBusinessLayer）没有
    if (entry.hide) {
      entry.hide.forEach((fn) => fn())
    }
    layerCatalog.value.splice(idx, 1)
  }

  function clearLayerCatalog(): void {
    layerCatalog.value = []
  }

  function setActivePanel(panelName: string): void {
    if (activePanel.value === panelName) {
      activePanel.value = 'none'
    } else {
      activePanel.value = panelName
      if (panelName === 'port-info') {
        selectedXiaoqu.value = null
      }
    }
  }

  function closePanel(): void {
    activePanel.value = 'none'
    selectedXiaoqu.value = null
  }

  function setSelectedXiaoqu(xiaoqu: ScoredXiaoqu | null): void {
    selectedXiaoqu.value = xiaoqu
  }

  return {
    map,
    mapType,
    selectedPort,
    layerCatalog,
    baseLayerKey,
    currentRenderer,
    analysisHandler,
    activePanel,
    selectedXiaoqu,
    setMap,
    setCurrentRenderer,
    setMapType,
    setSelectedPort,
    clearSelectedPort,
    registerAnalysisHandler,
    setAnalysisResult,
    registerLayer,
    registerBaseLayer,
    registerToggleable,
    registerBusinessLayer,
    toggleLayer,
    removeLayer,
    clearLayerCatalog,
    setActivePanel,
    closePanel,
    setSelectedXiaoqu,
  }
})

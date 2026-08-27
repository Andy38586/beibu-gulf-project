import { defineStore } from 'pinia'
import type { Ref, ShallowRef } from 'vue'
import { ref, shallowRef } from 'vue'

import { logger } from '@/shared'
import type { EngineName, LayerEntry, LayerType, MapType, Port } from '@/types'
import type { MapRenderer } from '@/types'

/** localStorage 键：底图 */
const BASE_LAYER_STORAGE_KEY = 'beibu-gulf-base-layer'
/** 合法底图 key 白名单（与 UnifiedMap.vue registerBaseLayer 注册处同源；防旧版本残留值污染） */
const BASE_LAYER_KEYS = ['base-image', 'base-vector']

function readStoredBaseLayer(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const key = window.localStorage.getItem(BASE_LAYER_STORAGE_KEY)
    // 白名单校验：底图 key 集合演进后，旧 localStorage 值可能指向已不存在的底图，
    // 直接透传会导致初始底图静默降级且面板无高亮（P1-8）
    return key && BASE_LAYER_KEYS.includes(key) ? key : null
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

export const useMapStore = defineStore('map', () => {
  // 地图与分析结果不持久化（无读取方的死状态已删）；跨页恢复只走 useSiteSelectionStore 内存快照
  const selectedPort: Ref<Port | null> = ref(null)
  const mapType: Ref<MapType> = ref('2d')
  // shallowRef（浅响应式）：条目变更由各 action 重建数组触发，避免深度代理 50 个图层对象
  const layerCatalog: ShallowRef<LayerEntry[]> = shallowRef([])
  const baseLayerKey: Ref<string | null> = ref(readStoredBaseLayer())

  /** 当前渲染器引用（由UnifiedMap设置，供业务组件访问） */
  const currentRenderer: ShallowRef<MapRenderer | null> = shallowRef(null)

  // 由 UnifiedMap 在渲染器初始化/切换时调用
  function setCurrentRenderer(renderer: MapRenderer | null): void {
    currentRenderer.value = renderer
  }

  // 地图类型仅内存态（无读取方的持久化已移除），刷新回退默认 '2d'
  function setMapType(type: MapType): void {
    mapType.value = type
  }

  function setSelectedPort(port: Port | null): void {
    selectedPort.value = port
  }

  function clearSelectedPort(): void {
    selectedPort.value = null
  }

  /** 注册底图条目（幂等——UnifiedMap 每次引擎切换都会调用，已存在则跳过） */
  function registerBaseLayer(key: string, label: string): void {
    const existing = layerCatalog.value.find((e: LayerEntry) => e.key === key)
    if (existing) return
    const isFirstBase = layerCatalog.value.every((e: LayerEntry) => e.category !== 'base')
    // 可见性以持久化的底图 key 为准，未设置时默认第一张可见
    const storedKey = baseLayerKey.value
    const visible = storedKey ? key === storedKey : isFirstBase
    layerCatalog.value = [...layerCatalog.value, { key, label, visible, category: 'base' }]
  }

  /** 注册业务图层：仅存元数据（key/label/layerType/visible/category），不存回调、不触发显隐——渲染由 LayerControlPanel 读条目驱动 */
  function registerBusinessLayer(
    key: string,
    label: string,
    layerType: LayerType,
    visible: boolean = true,
    engines: EngineName[] = ['openlayers', 'cesium']
  ): void {
    const existing = layerCatalog.value.find((e: LayerEntry) => e.key === key)
    if (existing) {
      // 已存在则更新可见性与类型（不可变更新，配合 shallowRef 浅响应式）
      layerCatalog.value = layerCatalog.value.map((e: LayerEntry) =>
        e.key === key ? { ...e, visible, layerType, engines } : e
      )
      return
    }
    const newEntry: LayerEntry = {
      key,
      label,
      layerType,
      visible,
      engines,
      category: 'business',
    }
    layerCatalog.value = [...layerCatalog.value, newEntry]
  }

  /** 切换底图（互斥）：key 持久化到 localStorage，catalog base 条目 visible 同步镜像，供控制面板调用 */
  let lastBaseRenderer: MapRenderer | null = null // 底图指令最近应用到的渲染器实例（引擎切换后需重放）
  function setBaseLayer(key: string): void {
    const entry = layerCatalog.value.find((e: LayerEntry) => e.key === key)
    if (!entry || entry.category !== 'base') return

    // 通知当前渲染器切换底图引擎（OL/Cesium 渲染器均实现 setBaseLayer）
    const renderer = currentRenderer.value as
      | (MapRenderer & { setBaseLayer?: (type: string) => void })
      | null

    // no-op 仅限「同 key 且已应用到当前渲染器实例」——引擎切换后渲染器是新实例，
    // 即使 key 未变也必须重放，否则新引擎保持默认底图而权威键不变（面板与屏幕脱节）
    if (baseLayerKey.value === key && entry.visible && renderer === lastBaseRenderer) return

    // base 条目互斥可见（不可变更新，配合 shallowRef 浅响应式）
    layerCatalog.value = layerCatalog.value.map((e: LayerEntry) => {
      if (e.category !== 'base') return e
      return { ...e, visible: e.key === key }
    })

    baseLayerKey.value = key
    writeStoredBaseLayer(key)

    // 渲染器未就绪（null）：状态已更新、不记 lastBaseRenderer——渲染器就绪后 setupLayers 重放权威键
    if (!renderer) return
    lastBaseRenderer = renderer

    renderer.setBaseLayer?.(key === 'base-image' ? 'image' : 'vector')
  }

  function removeLayer(key: string): void {
    const idx = layerCatalog.value.findIndex((e: LayerEntry) => e.key === key)
    if (idx < 0) return
    // 仅删条目：显隐由 BusinessLayerManager.setVisible 驱动（不可变更新，配合 shallowRef）
    layerCatalog.value = layerCatalog.value.filter((_, i) => i !== idx)
  }

  function clearLayerCatalog(): void {
    layerCatalog.value = []
  }

  /** 设置图层可见性：必须经 action 走不可变更新，Pinia 状态库才能正确追踪（绕过 action 直接改条目会丢响应式与 DevTools 记录） */
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
   * 统一重置地图业务交互状态（登出/业务切换时调用）：
   * 清 selectedPort 与业务图层条目；保留底图条目（避免控制面板底图区空白）、
   * mapType/baseLayerKey（用户偏好）与 currentRenderer（渲染器生命周期由 UnifiedMap 持有，登出时组件未卸载）
   */
  function resetMapState(): void {
    selectedPort.value = null
    layerCatalog.value = layerCatalog.value.filter((e: LayerEntry) => e.category !== 'business')
  }

  return {
    mapType,
    selectedPort,
    layerCatalog,
    baseLayerKey,
    currentRenderer,
    setCurrentRenderer,
    setMapType,
    setSelectedPort,
    clearSelectedPort,
    registerBaseLayer,
    registerBusinessLayer,
    setBaseLayer,
    removeLayer,
    clearLayerCatalog,
    setLayerVisible,
    resetMapState,
  }
})

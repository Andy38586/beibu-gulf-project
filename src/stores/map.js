import { defineStore } from 'pinia'
import { shallowRef, ref } from 'vue'

/** localStorage 键：持久化选中的底图图层 key */
const BASE_LAYER_STORAGE_KEY = 'beibu-gulf-base-layer'
/** localStorage 键：持久化地图类型（2d/3d） */
const MAP_TYPE_STORAGE_KEY = 'beibu-gulf-map-type'
/** localStorage 键：持久化选中的港口 */
const SELECTED_PORT_STORAGE_KEY = 'beibu-gulf-selected-port'
/** sessionStorage 键：持久化分析结果（会话级别） */
const ANALYSIS_RESULT_STORAGE_KEY = 'beibu-gulf-analysis-result'

function readStoredBaseLayer() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(BASE_LAYER_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredBaseLayer(key) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(BASE_LAYER_STORAGE_KEY, key)
  } catch {
    // 忽略隐私模式等写入失败场景
  }
}

function readStoredMapType() {
  if (typeof window === 'undefined') return '2d'
  try {
    return window.localStorage.getItem(MAP_TYPE_STORAGE_KEY) || '2d'
  } catch {
    return '2d'
  }
}

function writeStoredMapType(type) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(MAP_TYPE_STORAGE_KEY, type)
  } catch {
    // 忽略隐私模式等写入失败场景
  }
}

function readStoredSelectedPort() {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(SELECTED_PORT_STORAGE_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

function writeStoredSelectedPort(port) {
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

/**
 * 从 sessionStorage 读取分析结果
 * @returns {object | null}
 */
function readStoredAnalysisResult() {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.sessionStorage.getItem(ANALYSIS_RESULT_STORAGE_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

/**
 * 将分析结果写入 sessionStorage
 * @param {object | null} result
 */
function writeStoredAnalysisResult(result) {
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
  const map = shallowRef(null)
  const selectedPort = ref(null)
  const mapType = ref('2d')
  const layerCatalog = ref([])
  const baseLayerKey = ref(readStoredBaseLayer())

  const analysisHandler = ref(null)
  // AUDIT-003 (状态): 从 sessionStorage 恢复分析结果
  const lastAnalysisResult = ref(readStoredAnalysisResult())

  const activePanel = ref('none')
  const selectedXiaoqu = ref(null)

  function setMap(instance) {
    map.value = instance
  }

  // AUDIT-012: 删除重复函数，保留 setMapType
  // AUDIT-004 (状态): 持久化地图类型
  function setMapType(type) {
    mapType.value = type
    writeStoredMapType(type)
  }

  function setSelectedPort(port) {
    selectedPort.value = port
    writeStoredSelectedPort(port)
  }

  function clearSelectedPort() {
    selectedPort.value = null
    writeStoredSelectedPort(null)
  }

  function registerAnalysisHandler(handler) {
    // AUDIT-023: 验证handler是否为函数
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

  function setAnalysisResult(result) {
    lastAnalysisResult.value = result
    // AUDIT-003 (状态): 持久化分析结果到 sessionStorage
    writeStoredAnalysisResult(result)
    // AUDIT-015: 验证 analysisHandler 是否为函数
    if (typeof analysisHandler.value === 'function') {
      analysisHandler.value(result)
    }
  }

  function registerLayer(key, label, options) {
    const { visible = false, category = 'business', show, hide } = options

    const existingIndex = layerCatalog.value.findIndex((e) => e.key === key)
    if (existingIndex >= 0) {
      const existing = layerCatalog.value[existingIndex]
      if (show) existing.show.push(show)
      if (hide) existing.hide.push(hide)
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

  function registerBaseLayer(key, label, show, hide) {
    const existing = layerCatalog.value.find((e) => e.key === key)
    const isFirstBase = layerCatalog.value.every((e) => e.category !== 'base')
    // 优先以 localStorage 中持久化的底图 key 为准；未设置时默认第一个底图可见
    const storedKey = baseLayerKey.value
    const shouldVisible = existing ? existing.visible : storedKey ? key === storedKey : isFirstBase

    const wrappedShow = () => {
      layerCatalog.value
        .filter((e) => e.category === 'base' && e.key !== key)
        .forEach((e) => {
          e.visible = false
          e.hide.forEach((fn) => fn())
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

  function registerToggleable(key, label, show, hide) {
    const existing = layerCatalog.value.find((e) => e.key === key)
    const shouldVisible = existing ? existing.visible : true

    registerLayer(key, label, {
      visible: shouldVisible,
      category: 'business',
      show,
      hide,
    })

    if (shouldVisible) {
      show()
    }
  }

  function toggleLayer(key) {
    const entry = layerCatalog.value.find((e) => e.key === key)
    // AUDIT-024: 验证entry存在性
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

  function handleBaseLayerToggle(entry) {
    if (entry.visible) {
      // 底图必须保留一个可见，避免地图无背景
      return
    }

    layerCatalog.value
      .filter((e) => e.category === 'base')
      .forEach((e) => {
        e.visible = false
        e.hide.forEach((fn) => fn())
      })

    entry.visible = true
    baseLayerKey.value = entry.key
    writeStoredBaseLayer(entry.key)
    entry.show.forEach((fn) => fn())
  }

  function handleBusinessLayerToggle(entry) {
    entry.visible = !entry.visible

    if (entry.visible) {
      entry.show.forEach((fn) => fn())
    } else {
      entry.hide.forEach((fn) => fn())
    }
  }

  /**
   * 移除指定图层（从 catalog 中删除并调用 hide）
   * 用于进入选址分析页前清除旧的分析图层
   */
  function removeLayer(key) {
    const idx = layerCatalog.value.findIndex((e) => e.key === key)
    if (idx < 0) return
    const entry = layerCatalog.value[idx]
    entry.hide.forEach((fn) => fn())
    layerCatalog.value.splice(idx, 1)
  }

  function clearLayerCatalog() {
    layerCatalog.value = []
  }

  function setActivePanel(panelName) {
    if (activePanel.value === panelName) {
      activePanel.value = 'none'
    } else {
      activePanel.value = panelName
      if (panelName === 'port-info') {
        selectedXiaoqu.value = null
      }
    }
  }

  function closePanel() {
    activePanel.value = 'none'
    selectedXiaoqu.value = null
  }

  function setSelectedXiaoqu(xiaoqu) {
    selectedXiaoqu.value = xiaoqu
  }

  return {
    map,
    mapType,
    selectedPort,
    layerCatalog,
    baseLayerKey,
    analysisHandler,
    activePanel,
    selectedXiaoqu,
    setMap,
    setMapType,
    setSelectedPort,
    clearSelectedPort,
    registerAnalysisHandler,
    setAnalysisResult,
    registerLayer,
    registerBaseLayer,
    registerToggleable,
    toggleLayer,
    removeLayer,
    clearLayerCatalog,
    setActivePanel,
    closePanel,
    setSelectedXiaoqu,
  }
})

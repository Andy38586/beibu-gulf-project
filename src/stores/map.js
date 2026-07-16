import { defineStore } from 'pinia'
import { shallowRef, ref } from 'vue'

/** localStorage 键：持久化当前选中的底图图层 key */
const BASE_LAYER_STORAGE_KEY = 'beibu-gulf-base-layer'

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

export const useMapStore = defineStore('map', () => {
  const map = shallowRef(null)
  const selectedPort = ref(null)
  const mapType = ref('2d')
  const layerCatalog = ref([])
  const baseLayerKey = ref(readStoredBaseLayer())

  const analysisHandler = ref(null)
  const lastAnalysisResult = ref(null)

  const activePanel = ref('none')
  const selectedXiaoqu = ref(null)

  function setMap(instance) {
    map.value = instance
  }

  function setMapType(type) {
    mapType.value = type
  }

  function switchMapType(type) {
    mapType.value = type
  }

  function setSelectedPort(port) {
    selectedPort.value = port
  }

  function clearSelectedPort() {
    selectedPort.value = null
  }

  function registerAnalysisHandler(handler) {
    analysisHandler.value = handler
    if (lastAnalysisResult.value) {
      handler(lastAnalysisResult.value)
    }
  }

  function setAnalysisResult(result) {
    lastAnalysisResult.value = result
    analysisHandler.value?.(result)
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
    if (!entry) return

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
    switchMapType,
    setSelectedPort,
    clearSelectedPort,
    registerAnalysisHandler,
    setAnalysisResult,
    registerLayer,
    registerBaseLayer,
    registerToggleable,
    toggleLayer,
    clearLayerCatalog,
    setActivePanel,
    closePanel,
    setSelectedXiaoqu,
  }
})

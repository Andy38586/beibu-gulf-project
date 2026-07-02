import { defineStore } from 'pinia'
import { shallowRef, ref } from 'vue'

export const useMapStore = defineStore('map', () => {
  const map = shallowRef(null)
  const selectedPort = ref(null)
  const routeLayers = ref(new Map())
  const activeRoute = ref('')
  const mapType = ref('2d')
  const layerCatalog = ref([])

  const analysisHandler = ref(null)
  const lastAnalysisResult = ref(null)

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

  function registerLayers(routeName, layers) {
    if (!map.value) return
    const old = routeLayers.value.get(routeName)
    old?.forEach((l) => map.value.removeLayer(l))
    layers.forEach((layer) => {
      layer.set('routeName', routeName)
      layer.setVisible(layer.get('alwaysVisible') || routeName === activeRoute.value)
      map.value.addLayer(layer)
    })
    routeLayers.value.set(routeName, layers)
  }

  function switchRoute(routeName) {
    activeRoute.value = routeName
    routeLayers.value.forEach((layers, name) => {
      layers.forEach((layer) => {
        layer.setVisible(layer.get('alwaysVisible') || name === routeName)
      })
    })
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
    const shouldVisible = existing ? existing.visible : isFirstBase

    const wrappedShow = () => {
      layerCatalog.value
        .filter((e) => e.category === 'base' && e.key !== key)
        .forEach((e) => {
          e.visible = false
          e.hide.forEach((fn) => fn())
        })
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
      entry.visible = false
      entry.hide.forEach((fn) => fn())
      return
    }

    layerCatalog.value
      .filter((e) => e.category === 'base')
      .forEach((e) => {
        e.visible = false
        e.hide.forEach((fn) => fn())
      })

    entry.visible = true
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

  return {
    map,
    mapType,
    selectedPort,
    activeRoute,
    routeLayers,
    layerCatalog,
    analysisHandler,
    setMap,
    setMapType,
    switchMapType,
    setSelectedPort,
    clearSelectedPort,
    registerAnalysisHandler,
    setAnalysisResult,
    registerLayers,
    switchRoute,
    registerLayer,
    registerBaseLayer,
    registerToggleable,
    toggleLayer,
    clearLayerCatalog,
  }
})

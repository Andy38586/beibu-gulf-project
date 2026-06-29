import { defineStore } from 'pinia'
import { shallowRef, ref } from 'vue'

export const useMapStore = defineStore('map', () => {
  const map = shallowRef(null)
  const selectedPort = ref(null)
  const activeBaseMap = ref('image')
  const routeLayers = ref(new Map())
  const activeRoute = ref('')

  let baseMapSwitcher = null
  let analysisHandler = null

  function setMap(instance) {
    map.value = instance
  }
  function setSelectedPort(port) {
    selectedPort.value = port
  }
  function clearSelectedPort() {
    selectedPort.value = null
  }
  function registerBaseMapSwitcher(handler) {
    baseMapSwitcher = handler
  }
  function switchBaseMap(type) {
    activeBaseMap.value = type
    baseMapSwitcher?.(type)
  }
  function registerAnalysisHandler(handler) {
    analysisHandler = handler
  }
  function setAnalysisResult(result) {
    analysisHandler?.(result)
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
  return {
    map,
    selectedPort,
    activeBaseMap,
    activeRoute,
    routeLayers,
    setMap,
    setSelectedPort,
    clearSelectedPort,
    registerBaseMapSwitcher,
    switchBaseMap,
    registerAnalysisHandler,
    setAnalysisResult,
    registerLayers,
    switchRoute,
  }
})

<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { useMapInit } from '@/composables/useMapInit'
import { useBaseLayers } from '@/composables/useBaseLayers'
import { useLayerManager } from '@/composables/useLayerManager'
import { useAnalysisLayer } from '@/composables/useAnalysisLayer'
import { loadPorts, buildPortLayer } from '@/composables/usePortLayer'
import { buildBoundaryLayer } from '@/composables/useBoundaryLayer'
import { useMapClick } from '@/composables/useMapClick'
import { useMapStore } from '@/stores/map'

const loading = ref(true)
const loadError = ref('')
const boundaryWarning = ref('')

const mapStore = useMapStore()
let clickController = null

async function init() {
  const map = useMapInit('global-map', { minZoom: 9 })
  const { switchBaseMap: switchFn } = useBaseLayers(map)
  mapStore.registerBaseMapSwitcher(switchFn)
  switchFn(mapStore.activeBaseMap)

  try {
    const ports = await loadPorts()
    const portLayer = buildPortLayer(ports)
    const boundaryLayer = buildBoundaryLayer((msg) => (boundaryWarning.value = msg))
    portLayer.set('alwaysVisible', true)
    boundaryLayer.set('alwaysVisible', true)

    const { addLayers } = useLayerManager()
    addLayers('home', [boundaryLayer, portLayer])

    const { setAnalysisResult } = useAnalysisLayer(map)
    mapStore.registerAnalysisHandler(setAnalysisResult)

    clickController = useMapClick(map, {
      onPortClick: (portData) => mapStore.setSelectedPort(portData),
      onBlankClick: () => mapStore.clearSelectedPort(),
    })
  } catch (error) {
    console.error('地图初始化失败:', error)
    loadError.value = error.message || '加载失败'
  } finally {
    loading.value = false
  }
}
onMounted(init)

onUnmounted(() => {
  clickController?.destroy()
})
</script>

<template>
  <div class="map-wrapper">
    <div id="global-map" class="map-fill"></div>
    <div v-if="loading" class="map-loading">地图加载中...</div>
    <p v-if="loadError" class="map-error">{{ loadError }}</p>
    <div v-if="boundaryWarning" class="boundary-warning">{{ boundaryWarning }}</div>
  </div>
</template>

<style scoped>
.map-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
}
.map-fill {
  width: 100%;
  height: 100%;
}
.map-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.8);
  z-index: 20;
}
.map-error {
  position: absolute;
  top: 10px;
  left: 10px;
  color: #e74c3c;
  z-index: 20;
}
.boundary-warning {
  position: absolute;
  bottom: 10px;
  left: 10px;
  background: rgba(255, 200, 0, 0.9);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  z-index: 15;
}
</style>

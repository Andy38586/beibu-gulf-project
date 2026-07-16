<script setup>
import { ref, watch, onMounted, onUnmounted, provide, nextTick } from 'vue'
import { createRenderer } from '@/core/map/renderers'
import { MapRendererKey } from '@/core/map/composables/useMapRenderer'
import { useMapStore } from '@/stores/map'
import { loadPorts, buildPortGeoJson, PORT_STYLE } from '@/composables/usePortLayer'
import { loadBoundaryGeoJson, BOUNDARY_STYLE } from '@/composables/useBoundaryLayer'
import { useAnalysisLayer } from '@/composables/useAnalysisLayer'
import { useLayerManager } from '@/core/map/composables/useLayerManager'

const props = defineProps({
  mapType: {
    type: String,
    default: '2d',
    validator: (v) => ['2d', '3d'].includes(v),
  },
  center: {
    type: Array,
    default: () => [108.1, 21.5],
  },
  zoom: {
    type: Number,
    default: 9,
  },
})

const emit = defineEmits(['typeChange', 'click', 'error'])

const containerRef = ref(null)
const loading = ref(true)
const switching = ref(false)
const loadError = ref('')
const boundaryWarning = ref('')
const currentRenderer = ref(null)
const lastState = ref(null)
const mapStore = useMapStore()
const { registerBaseLayerWithRenderer, registerToggleable, clearLayers } = useLayerManager()
const { createUpdateHandler } = useAnalysisLayer()

provide(MapRendererKey, currentRenderer)

let portGeoJson = null
let boundaryGeoJson = null

async function loadData() {
  try {
    const ports = await loadPorts()
    portGeoJson = buildPortGeoJson(ports)
    boundaryGeoJson = await loadBoundaryGeoJson((msg) => {
      boundaryWarning.value = msg
    })
  } catch (error) {
    console.error('地图数据加载失败:', error)
  }
}

async function initRenderer(type) {
  if (!containerRef.value) return

  if (currentRenderer.value) {
    lastState.value = currentRenderer.value.exportState()
    currentRenderer.value.destroy()
    currentRenderer.value = null
  }

  switching.value = true
  loading.value = true
  await nextTick()

  try {
    currentRenderer.value = createRenderer(type, containerRef.value)
    await nextTick()

    if (type === '2d') {
      currentRenderer.value.updateSize()
    }

    if (lastState.value) {
      currentRenderer.value.importState(lastState.value)
    }

    setupLayers(type)
    setupEvents(type)
    mapStore.setMap(
      type === '2d' ? currentRenderer.value.getMap() : currentRenderer.value.getViewer(),
    )
    mapStore.setMapType(type)
  } catch (error) {
    console.error(`Renderer ${type} 初始化失败:`, error)
    loadError.value = error.message || '地图初始化失败'
    emit('error', error)
  } finally {
    switching.value = false
    loading.value = false
  }
}
function setupLayers() {
  clearLayers()
  registerBaseLayerWithRenderer('base-image', '影像底图', currentRenderer.value)
  registerBaseLayerWithRenderer('base-vector', '矢量底图', currentRenderer.value)
  if (boundaryGeoJson) {
    currentRenderer.value.addGeoJsonLayer('boundary', boundaryGeoJson, BOUNDARY_STYLE)
    registerToggleable('boundary', '行政区划', currentRenderer.value)
  }
  if (portGeoJson) {
    currentRenderer.value.addPointLayer(
      'ports',
      portGeoJson.features.map((f) => ({
        ...f.properties,
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
      })),
      PORT_STYLE,
    )
    registerToggleable('ports', '港口位置', currentRenderer.value)
  }
  const updateHandler = createUpdateHandler(currentRenderer.value, registerToggleable)
  mapStore.registerAnalysisHandler(updateHandler)
}
function setupEvents() {
  currentRenderer.value.on('click', (event) => {
    const { featureType, data, coordinate } = event.detail
    if (featureType === 'port' && data) {
      mapStore.setSelectedPort(data)
    } else {
      mapStore.clearSelectedPort()
    }
    emit('click', { featureType, data, coordinate })
  })
}
async function switchMapType(type) {
  emit('typeChange', type)
  await initRenderer(type)
}
function flyTo(target, options = {}) {
  currentRenderer.value?.flyTo(target, options)
}
function getRenderer() {
  return currentRenderer.value
}
function startBreathing(lng, lat) {
  currentRenderer.value?.startBreathing(lng, lat)
}
function stopBreathing() {
  currentRenderer.value?.stopBreathing()
}
watch(
  () => props.mapType,
  async (newType) => {
    await switchMapType(newType)
  },
)
onMounted(async () => {
  await loadData()
  await initRenderer(props.mapType)
})
onUnmounted(() => {
  if (currentRenderer.value) {
    currentRenderer.value.destroy()
    currentRenderer.value = null
  }
})
defineExpose({
  switchMapType,
  flyTo,
  getRenderer,
  startBreathing,
  stopBreathing,
})
</script>

<template>
  <div class="unified-map-wrapper">
    <div ref="containerRef" class="map-container" :class="{ switching }"></div>

    <Transition name="fade">
      <div v-if="loading || switching" class="map-loading">
        <div class="loading-spinner"></div>
        <span>{{ switching ? '切换视图中...' : '地图加载中...' }}</span>
      </div>
    </Transition>

    <p v-if="loadError" class="map-error">{{ loadError }}</p>

    <div v-if="boundaryWarning" class="boundary-warning">{{ boundaryWarning }}</div>
  </div>
</template>

<style scoped>
.unified-map-wrapper {
  position: absolute;
  inset: 0;
  overflow: hidden;
  z-index: 1;
}

.map-container {
  width: 100%;
  height: 100%;
  transition: opacity 0.3s ease;
}

.map-container.switching {
  opacity: 0.5;
}

.map-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.85);
  z-index: 100;
  gap: 12px;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #409eff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.map-error {
  position: absolute;
  top: 10px;
  left: 10px;
  color: #e74c3c;
  background: rgba(255, 255, 255, 0.9);
  padding: 8px 12px;
  border-radius: 6px;
  z-index: 100;
}

.boundary-warning {
  position: absolute;
  bottom: 10px;
  left: 10px;
  background: rgba(255, 200, 0, 0.9);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  z-index: 90;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>

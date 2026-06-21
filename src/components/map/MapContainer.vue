<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import Map from 'ol/Map'
import View from 'ol/View'
import TileLayer from 'ol/layer/Tile'
import OSM from 'ol/source/OSM'
import VectorSource from 'ol/source/Vector'
import VectorLayer from 'ol/layer/Vector'
import { fromLonLat } from 'ol/proj'
import Point from 'ol/geom/Point'
import Feature from 'ol/Feature'
import GeoJSON from 'ol/format/GeoJSON'
import 'ol/ol.css'

const emit = defineEmits(['update:selectedPort'])
const ports = ref([])
const loading = ref(true)
const loadError = ref(false)
const boundaryWarning = ref('')

let map = null

async function loadPorts() {
  const response = await fetch('/data/ports.json')
  if (!response.ok) {
    throw new Error(`港口数据请求失败  HTTP ${response.status}`)
  }
  const data = await response.json()
  if (!Array.isArray(data)) {
    throw new Error(`港口数据格式异常`)
  }
  return data
}
function initMap() {
  const portFeatures = ports.value.map((port) => {
    const feature = new Feature({
      geometry: new Point(fromLonLat([port.lon, port.lat])),
    })
    feature.setProperties(port)
    feature.set('featureType', 'port') //加个标识
    return feature
  })
  const portSource = new VectorSource({
    features: portFeatures,
  })
  const portLayer = new VectorLayer({
    source: portSource,
  })
  const boundarySource = new VectorSource({
    url: '/beibu-gulf-merged-data.geojson',
    format: new GeoJSON(),
  })
  boundarySource.on('featuresloaderror', () => {
    console.error('边界数据加载失败')
    boundaryWarning.value = '边界数据加载失败,图层可能缺失'
  })
  const boundaryLayer = new VectorLayer({
    source: boundarySource,
  })
  map = new Map({
    target: 'map',
    view: new View({
      center: fromLonLat([108.6, 21.95]),
      zoom: 8,
    }),
    layers: [
      new TileLayer({
        source: new OSM(),
      }),
      boundaryLayer,
      portLayer,
    ],
  })
  map.on('click', (event) => {
    let clicked = false
    map.forEachFeatureAtPixel(event.pixel, (feature) => {
      if (feature.get('featureType') !== 'port') {
        return
      }
      clicked = true
      // eslint-disable-next-line no-unused-vars
      const { geometry, ...portData } = feature.getProperties()
      emit('update:selectedPort', portData)
    })
    if (!clicked) {
      emit('update:selectedPort', null)
    }
  })
}
async function init() {
  loading.value = true
  loadError.value = false
  try {
    ports.value = await loadPorts()
    initMap()
  } catch (error) {
    console.error('加载失败:', error)
    loadError.value = error.message || `未知错误,请稍后重试`
  } finally {
    loading.value = false
  }
}
function retry() {
  init()
}
onMounted(init)

onUnmounted(() => {
  if (map) {
    map.setTarget(null)
    map = null
  }
})
</script>

<template>
  <div class="map-wrapper">
    <div id="map"></div>
    <div v-if="loading" class="map-loading">
      <div class="spinner"></div>
      <span>地图加载中...</span>
    </div>
    <div v-else-if="loadError" class="map-error">
      <p>{{ loadError }}</p>
      <button @click="retry">重新加载</button>
    </div>
    <div v-if="boundaryWarning" class="boundary-warning">
      {{ boundaryWarning }}
    </div>
  </div>
</template>

<style scoped>
#map {
  width: 100%;
  height: 100%;
}
.map-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
}
.map-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.8);
  z-index: 20;
}
.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #ddd;
  border-top-color: #409eff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

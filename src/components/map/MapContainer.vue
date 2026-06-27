<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import Map from 'ol/Map'
import View from 'ol/View'
import TileLayer from 'ol/layer/Tile'
import XYZ from 'ol/source/XYZ'
import VectorSource from 'ol/source/Vector'
import VectorLayer from 'ol/layer/Vector'
import { fromLonLat } from 'ol/proj'
import Point from 'ol/geom/Point'
import Feature from 'ol/Feature'
import GeoJSON from 'ol/format/GeoJSON'
import 'ol/ol.css'
import { Style, Fill, Stroke, Circle as CircleStyle } from 'ol/style'

const props = defineProps({
  interactive: { type: Boolean, default: true },
  initialZoom: { type: Number, default: 9 },
  minZoom: { type: Number, default: 9 },
})
const emit = defineEmits(['update:selectedPort'])
const ports = ref([])
const loading = ref(true)
const loadError = ref(null)
const boundaryWarning = ref('')

let map = null
let coverageLayer = null
let matchedLayer = null
let isUpdating = false
let pendingResult = null

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
  if (map) {
    map.setTarget(null)
    map = null
  }
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
    url: '/beibu-gulf-merged-data.json',
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
    interactions: props.interactive ? undefined : [],
    view: new View({
      center: fromLonLat([108.6, 21.95]),
      zoom: 9,
      minZoom: props.minZoom,
    }),
    layers: [
      new TileLayer({
        source: new XYZ({
          url: `https://t0.tianditu.gov.cn/DataServer?T=vec_w&x={x}&y={y}&l={z}&tk=e4cef34602f9d6226f7d142990ab614e`,
        }),
      }),
      new TileLayer({
        source: new XYZ({
          url: `https://t0.tianditu.gov.cn/DataServer?T=cva_w&x={x}&y={y}&l={z}&tk=e4cef34602f9d6226f7d142990ab614e`,
        }),
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
function setAnalysisResult({ coverage, matchedXiaoqu }) {
  // ========== 以下为注释掉的原方法（保留供参考） ==========
  /*
  if (coverageLayer) {
    map.removeLayer(coverageLayer)
    coverageLayer = null
  }
  if (matchedLayer) {
    map.removeLayer(matchedLayer)
    matchedLayer = null
  }
  if (coverage) {
    const source = new VectorSource({
      features: new GeoJSON().readFeatures(coverage, { featureProjection: 'EPSG:3857' }),
    })
    coverageLayer = new VectorLayer({
      source,
      style: new Style({
        fill: new Fill({ color: 'rgba(64, 158, 255, 0.15)' }),
        stroke: new Stroke({ color: '#409eff', width: 1 }),
      }),
    })
    map.addLayer(coverageLayer)
  }
  if (matchedXiaoqu && matchedXiaoqu.length) {
    const features = matchedXiaoqu.map((xq) => {
      const f = new Feature({ geometry: new Point(fromLonLat([xq.lng, xq.lat])) })
      f.setProperties(xq)
      return f
    })
    matchedLayer = new VectorLayer({
      source: new VectorSource({ features }),
      style: new Style({
        image: new CircleStyle({
          radius: 6,
          fill: new Fill({ color: '#e74c3c' }),
          stroke: new Stroke({ color: '#fff', width: 1.5 }),
        }),
      }),
    })
    map.addLayer(matchedLayer)
  }
  */
  // ========== 原方法注释结束 ==========
  if (isUpdating) {
    pendingResult = { coverage, matchedXiaoqu }
    return
  }

  isUpdating = true

  try {
    if (coverageLayer) {
      try {
        map.removeLayer(coverageLayer)
        // eslint-disable-next-line no-empty, no-unused-vars
      } catch (e) {}
      coverageLayer = null
    }
    if (matchedLayer) {
      try {
        map.removeLayer(matchedLayer)
        // eslint-disable-next-line no-empty, no-unused-vars
      } catch (e) {}
      matchedLayer = null
    }
    if (coverage) {
      const source = new VectorSource({
        features: new GeoJSON().readFeatures(coverage, { featureProjection: 'EPSG:3857' }),
      })
      coverageLayer = new VectorLayer({
        source,
        style: new Style({
          fill: new Fill({ color: 'rgba(64, 158, 255, 0.15)' }),
          stroke: new Stroke({ color: '#409eff', width: 1 }),
        }),
      })
      map.addLayer(coverageLayer)
    }
    if (matchedXiaoqu && matchedXiaoqu.length) {
      const features = matchedXiaoqu.map((xq) => {
        const f = new Feature({ geometry: new Point(fromLonLat([xq.lng, xq.lat])) })
        f.setProperties(xq)
        return f
      })
      matchedLayer = new VectorLayer({
        source: new VectorSource({ features }),
        style: new Style({
          image: new CircleStyle({
            radius: 6,
            fill: new Fill({ color: '#e74c3c' }),
            stroke: new Stroke({ color: '#fff', width: 1.5 }),
          }),
        }),
      })
      map.addLayer(matchedLayer)
    }
  } finally {
    isUpdating = false
    if (pendingResult) {
      const next = pendingResult
      pendingResult = null
      setAnalysisResult(next)
    }
  }
}
defineExpose({ setAnalysisResult })

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
async function retry() {
  if (loading.value) return
  await init()
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

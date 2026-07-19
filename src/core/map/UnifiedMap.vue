<script setup>
import { ref, watch, onMounted, onUnmounted, provide, nextTick, computed } from 'vue'
import { createRenderer } from '@/core/map/renderers'
import { MapRendererKey } from '@/core/map/composables/useMapRenderer'
import { useMapStore } from '@/stores/map'
import { loadPorts, buildPortGeoJson, PORT_STYLE } from '@/core/map/composables/usePortLayer'
import { loadBoundaryGeoJson, BOUNDARY_STYLE } from '@/core/map/composables/useBoundaryLayer'
import { useAnalysisLayer } from '@/business/site-selection/composables/useAnalysisLayer'
import { useLayerManager } from '@/core/map/composables/useLayerManager'
import { CELL_PIXEL } from '@/core/layout/config.js'

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

// 用于 CSS v-bind 的计算属性：loading spinner 尺寸基于 CELL_PIXEL
const spinnerSizeCss = computed(() => `${Math.round(CELL_PIXEL * 0.5)}px`)

provide(MapRendererKey, currentRenderer)
// AUDIT-005(架构): 提供 mapStore 给 useLayerManager 使用
provide('mapStore', mapStore)

let portGeoJson = null
let boundaryGeoJson = null

// AUDIT-P07: 防抖定时器，避免频繁切换引擎
let switchDebounceTimer = null
const SWITCH_DEBOUNCE_DELAY = 300 // 300ms 防抖延迟

// AUDIT-119: 超时控制常量
const LOAD_DATA_TIMEOUT = 10000 // 数据加载超时：10秒
const INIT_RENDERER_TIMEOUT = 15000 // 渲染器初始化超时：15秒

/**
 * 带超时的 Promise 包装
 * AUDIT-119: 防止加载过程无限等待
 */
function withTimeout(promise, timeoutMs, errorMessage) {
  let timeoutId
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId))
}

async function loadData() {
  try {
    // AUDIT-119: 添加超时控制
    const ports = await withTimeout(
      loadPorts(),
      LOAD_DATA_TIMEOUT,
      '港口数据加载超时，请检查网络连接'
    )
    portGeoJson = buildPortGeoJson(ports)
    boundaryGeoJson = await withTimeout(
      loadBoundaryGeoJson((msg) => {
        boundaryWarning.value = msg
      }),
      LOAD_DATA_TIMEOUT,
      '边界数据加载超时，部分图层可能缺失'
    )
  } catch (error) {
    // AUDIT-017: 仅在开发环境输出错误
    if (import.meta.env.DEV) {
      console.error('地图数据加载失败:', error)
    }
    // AUDIT-119: 超时错误也要显示给用户
    if (error.message.includes('超时')) {
      loadError.value = error.message
    }
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
    currentRenderer.value = await createRenderer(type, containerRef.value)
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
    // AUDIT-314-004: 验证 GeoJSON Feature 完整性，过滤缺失 geometry 的 Feature
    const validFeatures = portGeoJson.features.filter((f) => {
      if (!f || !f.geometry || !f.geometry.coordinates) {
        if (import.meta.env.DEV) {
          console.warn('无效的 Feature，缺失 geometry:', f)
        }
        return false
      }
      if (!Array.isArray(f.geometry.coordinates) || f.geometry.coordinates.length < 2) {
        if (import.meta.env.DEV) {
          console.warn('无效的坐标数据:', f.geometry.coordinates)
        }
        return false
      }
      return true
    })
    
    if (validFeatures.length > 0) {
      currentRenderer.value.addPointLayer(
        'ports',
        validFeatures.map((f) => {
          // AUDIT-018: 验证geometry.coordinates存在性
          if (!f.geometry || !f.geometry.coordinates || !Array.isArray(f.geometry.coordinates)) {
            if (import.meta.env.DEV) {
              console.warn('港口Feature缺少有效坐标:', f)
            }
            return null
          }
          return {
            ...f.properties,
            lng: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
          }
        }).filter(Boolean),
        PORT_STYLE,
      )
      registerToggleable('ports', '港口位置', currentRenderer.value)
    }
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
  // AUDIT-P07: 添加防抖机制，避免快速切换导致引擎冲突
  if (switchDebounceTimer) {
    clearTimeout(switchDebounceTimer)
  }
  
  return new Promise((resolve) => {
    switchDebounceTimer = setTimeout(async () => {
      emit('typeChange', type)
      await initRenderer(type)
      switchDebounceTimer = null
      resolve()
    }, SWITCH_DEBOUNCE_DELAY)
  })
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
  width: v-bind(spinnerSizeCss);
  height: v-bind(spinnerSizeCss);
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

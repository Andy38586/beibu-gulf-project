<script setup lang="ts">
// 统一地图容器：OL/Cesium双引擎，v-show切换，渲染器实例复用不销毁
import { ref, watch, onMounted, onUnmounted, provide, nextTick, computed } from 'vue'
import { createRenderer } from '@/core/map/renderers'
import type { MapRenderer } from '@/core/map/renderers/MapRenderer'
import { MapRendererKey } from '@/core/map/composables/useMapRenderer'
import { useMapStore } from '@/stores/mapStore'
import { loadPorts, buildPortGeoJson, PORT_STYLE } from '@/core/map/composables/usePortLayer'
import { loadBoundaryGeoJson, BOUNDARY_STYLE } from '@/core/map/composables/useBoundaryLayer'
import { useLayerManager } from '@/core/map/composables/useLayerManager'
import { CELL_PIXEL } from '@/core/layout/config.js'
import { useGCS } from '@/core/layout/useGCS.js'
import { logger } from '@/shared/utils/logger'

const { cell8px } = useGCS()

interface Props {
  mapType?: '2d' | '3d'
}
const props = withDefaults(defineProps<Props>(), {
  mapType: '2d',
})

const emit = defineEmits<{
  'typeChange': [newType: '2d' | '3d']
  'click': [payload: { featureType: string; data: unknown; coordinate: unknown }]
  'error': [error: Error]
}>()

// 两个容器引用（OL始终存在，Cesium首次创建后保留）
const olContainerRef = ref<HTMLElement | null>(null)
const cesiumContainerRef = ref<HTMLElement | null>(null)

const loading = ref(true)
const switching = ref(false)
const loadError = ref('')
const boundaryWarning = ref('')
const currentRenderer = ref<MapRenderer | null>(null)
const mapStore = useMapStore()
const olRenderer = ref<MapRenderer | null>(null)
const cesiumRenderer = ref<MapRenderer | null>(null)
const cesiumInitialized = ref(false)

provide(MapRendererKey, currentRenderer)
provide('mapStore', mapStore)

const { registerBaseLayerWithRenderer, registerToggleable, clearLayers } = useLayerManager()

const spinnerSizeCss = computed(() => `${Math.round(CELL_PIXEL * 0.5)}px`)

let portGeoJson: any = null
let boundaryGeoJson: any = null

function withTimeout(promise, timeoutMs, errorMessage) {
  let timeoutId
  const timeoutPromise = new Promise<unknown>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId))
}

// v-show切换后浏览器未必完成layout，用rAF等待容器有实际尺寸再初始化渲染器
function waitForContainerVisible(container) {
  return new Promise<void>((resolve) => {
    if (container && container.offsetWidth > 0 && container.offsetHeight > 0) {
      resolve()
      return
    }
    let attempts = 0
    const maxAttempts = 10
    const check = () => {
      attempts++
      if (container && container.offsetWidth > 0 && container.offsetHeight > 0) {
        resolve()
      } else if (attempts < maxAttempts) {
        requestAnimationFrame(check)
      } else {
        if (import.meta.env.DEV) {
          logger.warn('waitForContainerVisible: 容器尺寸检查超时，继续执行')
        }
        resolve()
      }
    }
    requestAnimationFrame(check)
  })
}

async function loadData() {
  try {
    const ports = await withTimeout(loadPorts(), 10000, '港口数据加载超时')
    portGeoJson = buildPortGeoJson(ports)
    boundaryGeoJson = await withTimeout(
      loadBoundaryGeoJson((msg) => {
        boundaryWarning.value = msg
      }),
      10000,
      '边界数据加载超时'
    )
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    if (import.meta.env.DEV) {
      logger.error('地图数据加载失败:', err)
    }
    if (err.message.includes('超时')) {
      loadError.value = err.message
    }
  }
}

/**
 * 初始化指定类型的渲染器（首次创建或复用）
 * @param {'2d'|'3d'} type - 渲染器类型
 * @param {HTMLElement} container - DOM容器
 */
async function initRenderer(type, container) {
  if (!container) {
    if (import.meta.env.DEV) {
      logger.error(`initRenderer: ${type}容器为空`)
    }
    return
  }

  await waitForContainerVisible(container)

  try {
    const existingRenderer = type === '2d' ? olRenderer.value : cesiumRenderer.value

    if (existingRenderer) {
      // 复用已有渲染器
      currentRenderer.value = existingRenderer
      mapStore.setCurrentRenderer(existingRenderer)

      if (type === '3d') {
        const { cesiumViewerManager } = await import('@/core/map/renderers/CesiumRenderer')
        cesiumViewerManager.mount(container)
      }

      existingRenderer.updateSize()
      // 图层目录的show/hide绑定的是渲染器实例，切换回来需重新注册
      setupLayers()
    } else {
      const renderer = (await createRenderer(type, container)) as unknown as MapRenderer

      if (type === '2d') {
        olRenderer.value = renderer
      } else {
        cesiumRenderer.value = renderer
      }

      currentRenderer.value = renderer
      mapStore.setCurrentRenderer(renderer)
      renderer.updateSize()
      setupLayers()
      setupEvents()
    }

    mapStore.setMap(
      (type === '2d' ? currentRenderer.value?.getMap() : currentRenderer.value?.getViewer()) ?? null
    )
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    if (import.meta.env.DEV) {
      logger.error(`Renderer ${type} 初始化失败:`, err)
    }
    loadError.value = err.message || '地图初始化失败'
    emit('error', err)
  }
}

// 每次切换引擎时重新注册图层目录（show/hide绑定当前渲染器实例）
// _layers Map检查防止重复添加图层
function setupLayers() {
  const renderer = currentRenderer.value
  if (!renderer) return
  clearLayers()

  registerBaseLayerWithRenderer('base-image', '影像底图', renderer)
  registerBaseLayerWithRenderer('base-vector', '矢量底图', renderer)

  if (boundaryGeoJson && !renderer._layers.has('boundary')) {
    renderer.addGeoJsonLayer('boundary', boundaryGeoJson, BOUNDARY_STYLE)
  }
  if (boundaryGeoJson) {
    registerToggleable('boundary', '行政区划', renderer)
  }

  if (portGeoJson && !renderer._layers.has('ports')) {
    const validFeatures = portGeoJson.features.filter((f) => {
      if (!f?.geometry?.coordinates) return false
      if (!Array.isArray(f.geometry.coordinates) || f.geometry.coordinates.length < 2) return false
      const [lng, lat] = f.geometry.coordinates
      return !(lng === 0 && lat === 0)
    })
    if (validFeatures.length > 0) {
      renderer.addPointLayer(
        'ports',
        validFeatures
          .map((f) => ({
            ...f.properties,
            lng: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
          }))
          .filter(Boolean),
        PORT_STYLE
      )
    }
  }
  if (portGeoJson) {
    registerToggleable('ports', '港口位置', renderer)
  }
}

function setupEvents() {
  const renderer = currentRenderer.value
  if (!renderer) return
  renderer.on('click', (event) => {
    const { featureType, data, coordinate } = event.detail
    if (featureType === 'port' && data) {
      mapStore.setSelectedPort(data)
    } else {
      mapStore.clearSelectedPort()
    }
    emit('click', { featureType, data, coordinate })
  })
}

function getContainer(type) {
  return type === '2d' ? olContainerRef.value : cesiumContainerRef.value
}

// 双引擎切换：v-show控制显示，渲染器实例保留复用，失败时回滚mapType
async function switchMapType(newType) {
  if (switching.value) return

  // 用渲染器实际类型而非mapStore.mapType，后者可能已被route.meta.engine提前更新
  const oldType = (currentRenderer.value?.getType() || mapStore.mapType) as '2d' | '3d'
  switching.value = true
  loading.value = true

  logger.debug(`[UnifiedMap] switchMapType: ${oldType} → ${newType}`)
  logger.debug(
    `[UnifiedMap] mapStore.mapType=${mapStore.mapType}, currentRenderer.type=${currentRenderer.value?.getType()}`
  )

  // 如果 oldType 和 newType 相同，无需切换
  if (oldType === newType) {
    logger.debug('[UnifiedMap] 类型相同，跳过切换')
    switching.value = false
    loading.value = false
    return
  }

  try {
    let cameraState: any = null
    if (currentRenderer.value) {
      cameraState = currentRenderer.value.exportState()
    }

    if (mapStore.mapType !== newType) {
      mapStore.setMapType(newType)
    }

    if (newType === '3d' && !cesiumInitialized.value) {
      cesiumInitialized.value = true
      await nextTick()
      await nextTick()
    }

    const container = getContainer(newType)
    if (!container) {
      throw new Error(`${newType}容器未就绪（ref绑定失败）`)
    }

    // initRenderer 内部 waitForContainerVisible 等待浏览器 layout
    await initRenderer(newType, container)

    if (cameraState && currentRenderer.value) {
      currentRenderer.value.importState(cameraState)
    }

    emit('typeChange', newType)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    if (import.meta.env.DEV) {
      logger.error(`切换到 ${newType} 失败:`, err)
    }
    loadError.value = err.message || '地图切换失败'

    // 初始化失败时回滚 mapStore.mapType，避免容器因 v-show 被隐藏
    if (oldType !== newType) {
      mapStore.setMapType(oldType)
    }

    emit('error', err)
  } finally {
    switching.value = false
    loading.value = false
  }
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

// 监听mapType变化，直接调用switchMapType
// 策略：OL和Cesium容器都始终存在（v-show），渲染器实例保留不销毁
watch(
  () => props.mapType,
  async (newType) => {
    await switchMapType(newType)
  }
)

onMounted(async () => {
  await loadData()
  // 首次挂载：v-if已渲染默认类型的容器
  const container = getContainer(props.mapType)
  await initRenderer(props.mapType, container)
  loading.value = false
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
    <div v-show="mapType === '2d'" ref="olContainerRef" class="map-container"></div>

    <div
      v-if="cesiumInitialized"
      v-show="mapType === '3d'"
      ref="cesiumContainerRef"
      class="map-container"
    ></div>

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
  /* 确保地图容器可以接收鼠标事件，即使父元素设置了 pointer-events: none */
  pointer-events: auto;
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
  gap: 12px; /* 12px 非8的整数倍，保留 */
}

.loading-spinner {
  width: v-bind(spinnerSizeCss);
  height: v-bind(spinnerSizeCss);
  border: 4px solid var(--gcs-bg-container);
  border-top: 4px solid var(--gcs-color-primary);
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
  top: 10px; /* 10px 非8的整数倍，保留 */
  left: 10px; /* 10px 非8的整数倍，保留 */
  color: var(--gcs-color-error);
  background: rgba(255, 255, 255, 0.9);
  padding: v-bind(cell8px) 12px; /* 12px 非8的整数倍，保留 */
  border-radius: 6px;
  z-index: 100;
}

.boundary-warning {
  position: absolute;
  bottom: 10px; /* 10px 非8的整数倍，保留 */
  left: 10px; /* 10px 非8的整数倍，保留 */
  background: rgba(255, 200, 0, 0.9);
  padding: 6px 12px; /* 6px/12px 非8的整数倍，保留 */
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

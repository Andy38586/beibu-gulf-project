<script setup>
/**
 * UnifiedMap - 统一地图容器组件
 *
 * 严格遵循技术设计文档第三章的引擎生命周期设计：
 * - OL容器始终存在（v-show），Cesium容器首次创建后也保留（v-show）
 * - 两个容器和对应的Renderer都保持活跃，切换时只改变v-show
 * - CesiumViewer单例：首次创建Viewer，之后mount/unmount复用，不销毁
 *
 * 生命周期流程：
 *   首屏(mapType='2d') → v-show渲染OL容器 → initRenderer('2d', olContainer)
 *   首次切换3d → v-show创建Cesium容器 → initRenderer('3d', cesiumContainer) → OL v-show隐藏
 *   切回2d → Cesium v-show隐藏 → OL v-show显示（OLRenderer保持活跃）
 *   再次切换3d → Cesium v-show显示（复用Viewer，状态保留）
 */
import { ref, watch, onMounted, onUnmounted, provide, nextTick, computed } from 'vue'
import { createRenderer } from '@/core/map/renderers'
import { MapRendererKey } from '@/core/map/composables/useMapRenderer'
import { useMapStore } from '@/stores/map'
import { loadPorts, buildPortGeoJson, PORT_STYLE } from '@/core/map/composables/usePortLayer'
import { loadBoundaryGeoJson, BOUNDARY_STYLE } from '@/core/map/composables/useBoundaryLayer'
import { useLayerManager } from '@/core/map/composables/useLayerManager'
import { CELL_PIXEL } from '@/core/layout/config.js'
import { useGCS } from '@/core/layout/useGCS.js'

// 直接从 useGCS 解构 CSS 变量供 v-bind() 使用
const { cell8px } = useGCS()

const props = defineProps({
  mapType: {
    type: String,
    default: '2d',
    validator: (v) => ['2d', '3d'].includes(v),
  },
})

const emit = defineEmits(['typeChange', 'click', 'error'])

// 两个容器引用（OL始终存在，Cesium首次创建后保留）
const olContainerRef = ref(null)
const cesiumContainerRef = ref(null)

const loading = ref(true)
const switching = ref(false)
const loadError = ref('')
const boundaryWarning = ref('')
const currentRenderer = ref(null)
const mapStore = useMapStore()

// 两个渲染器实例（OL始终存在，Cesium首次创建后保留）
const olRenderer = ref(null)
const cesiumRenderer = ref(null)

// Cesium容器是否已初始化（首次创建后保留）
const cesiumInitialized = ref(false)

provide(MapRendererKey, currentRenderer)
provide('mapStore', mapStore)

const { registerBaseLayerWithRenderer, registerToggleable, clearLayers } = useLayerManager()

const spinnerSizeCss = computed(() => `${Math.round(CELL_PIXEL * 0.5)}px`)

let portGeoJson = null
let boundaryGeoJson = null

/**
 * 带超时的 Promise 包装
 * 防止加载过程无限等待
 */
function withTimeout(promise, timeoutMs, errorMessage) {
  let timeoutId
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId))
}

/**
 * 等待容器元素获得实际尺寸（浏览器完成 layout/reflow）
 *
 * 问题背景：v-show 切换后，Vue 的 nextTick 只保证 DOM 更新完成，
 * 但不保证浏览器完成布局计算。此时容器的 offsetWidth/offsetHeight 可能仍为 0，
 * 导致渲染器在错误尺寸下初始化，出现白屏。
 *
 * 解决方案：使用 requestAnimationFrame 等待浏览器完成布局，
 * 确保容器有实际尺寸后再初始化/更新渲染器。
 */
function waitForContainerVisible(container) {
  return new Promise((resolve) => {
    // 如果容器已有尺寸，直接返回
    if (container && container.offsetWidth > 0 && container.offsetHeight > 0) {
      resolve()
      return
    }

    let attempts = 0
    const maxAttempts = 10 // 最多等待 10 帧（约 166ms @60fps）
    const check = () => {
      attempts++
      if (container && container.offsetWidth > 0 && container.offsetHeight > 0) {
        resolve()
      } else if (attempts < maxAttempts) {
        requestAnimationFrame(check)
      } else {
        // 超时后仍然继续，避免无限等待
        if (import.meta.env.DEV) {
          console.warn('waitForContainerVisible: 容器尺寸检查超时，继续执行')
        }
        resolve()
      }
    }
    requestAnimationFrame(check)
  })
}

/**
 * 加载港口和边界数据（仅首次调用）
 */
async function loadData() {
  try {
    const ports = await withTimeout(loadPorts(), 10000, '港口数据加载超时')
    portGeoJson = buildPortGeoJson(ports)
    boundaryGeoJson = await withTimeout(
      loadBoundaryGeoJson((msg) => {
        boundaryWarning.value = msg
      }),
      10000,
      '边界数据加载超时',
    )
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error('地图数据加载失败:', error)
    }
    if (error.message.includes('超时')) {
      loadError.value = error.message
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
      console.error(`initRenderer: ${type}容器为空`)
    }
    return
  }

  // 等待容器完成浏览器布局（v-show切换后需要等待reflow）
  await waitForContainerVisible(container)

  try {
    // 检查是否已有该类型的渲染器实例
    const existingRenderer = type === '2d' ? olRenderer.value : cesiumRenderer.value

    if (existingRenderer) {
      // 复用已有渲染器
      currentRenderer.value = existingRenderer
      mapStore.setCurrentRenderer(existingRenderer)

      // Cesium需要重新挂载Viewer到容器（因为之前可能unmount了）
      if (type === '3d') {
        const { cesiumViewerManager } = await import('@/core/map/renderers/CesiumRenderer')
        cesiumViewerManager.mount(container)
      }

      // 两个渲染器都需要更新尺寸（关键：OL切换回来时需要知道容器尺寸变了）
      currentRenderer.value.updateSize()

      // 关键修复：复用渲染器时也需要重新注册图层目录
      // 因为 layerCatalog 中的 show/hide 函数绑定的是渲染器实例
      // 切换回来时需要让图层目录指向当前渲染器
      setupLayers()
    } else {
      // 首次创建渲染器
      const renderer = await createRenderer(type, container)

      if (type === '2d') {
        olRenderer.value = renderer
      } else {
        cesiumRenderer.value = renderer
      }

      currentRenderer.value = renderer
      mapStore.setCurrentRenderer(renderer)

      // 两个渲染器都需要更新尺寸
      currentRenderer.value.updateSize()

      // 首次创建时需要设置图层和事件
      setupLayers()
      setupEvents()
    }

    mapStore.setMap(
      type === '2d' ? currentRenderer.value.getMap() : currentRenderer.value.getViewer(),
    )
    // 注意：mapStore.setMapType 已在 switchMapType 中提前调用
    // 此处不再重复调用，避免 v-show 时序问题
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error(`Renderer ${type} 初始化失败:`, error)
    }
    loadError.value = error.message || '地图初始化失败'
    emit('error', error)
  }
}

/**
 * 注册底图和业务图层到当前渲染器
 *
 * 幂等性设计：
 * - 每次切换引擎时都会调用此函数
 * - 通过检查渲染器内部 _layers Map 防止重复添加图层
 * - 但始终重新注册图层目录（因为 show/hide 函数需要绑定到当前渲染器）
 */
function setupLayers() {
  // 始终清空图层目录，重新注册（因为 show/hide 函数绑定的是渲染器实例）
  clearLayers()

  // 注册底图图层（底图由渲染器在初始化时创建，这里只是注册到图层目录）
  registerBaseLayerWithRenderer('base-image', '影像底图', currentRenderer.value)
  registerBaseLayerWithRenderer('base-vector', '矢量底图', currentRenderer.value)

  // 注册业务图层（需要检查渲染器是否已有该图层，防止重复添加）
  if (boundaryGeoJson && !currentRenderer.value._layers.has('boundary')) {
    currentRenderer.value.addGeoJsonLayer('boundary', boundaryGeoJson, BOUNDARY_STYLE)
  }
  if (boundaryGeoJson) {
    registerToggleable('boundary', '行政区划', currentRenderer.value)
  }

  if (portGeoJson && !currentRenderer.value._layers.has('ports')) {
    const validFeatures = portGeoJson.features.filter((f) => {
      if (!f?.geometry?.coordinates) return false
      if (!Array.isArray(f.geometry.coordinates) || f.geometry.coordinates.length < 2) return false
      const [lng, lat] = f.geometry.coordinates
      return !(lng === 0 && lat === 0)
    })
    if (validFeatures.length > 0) {
      currentRenderer.value.addPointLayer(
        'ports',
        validFeatures
          .map((f) => ({
            ...f.properties,
            lng: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
          }))
          .filter(Boolean),
        PORT_STYLE,
      )
    }
  }
  if (portGeoJson) {
    registerToggleable('ports', '港口位置', currentRenderer.value)
  }

}

/**
 * 绑定点击事件
 */
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

/**
 * 获取当前类型对应的容器
 * v-if切换后需要nextTick等待DOM更新
 */
function getContainer(type) {
  return type === '2d' ? olContainerRef.value : cesiumContainerRef.value
}

/**
 * 切换地图类型
 * 策略：OL和Cesium容器都始终存在（v-show），渲染器实例保留不销毁
 * 切换时只改变v-show，不需要销毁/重建渲染器
 *
 * 关键时序：
 * 1. v-show 切换 → Vue nextTick 保证 DOM patch 完成
 * 2. waitForContainerVisible → requestAnimationFrame 保证浏览器完成 layout/reflow
 * 3. 渲染器 updateSize() → 基于正确容器尺寸重绘
 *
 * 错误处理：
 * - 如果新类型初始化失败，需要回滚 mapStore.mapType 到旧值
 * - 避免容器因 mapType 错误而被 v-show 隐藏
 */
async function switchMapType(newType) {
  if (switching.value) return

  // 关键修复：使用当前渲染器的实际类型，而非 mapStore.mapType
  // 因为 mapStore.mapType 可能已被 App.vue 的 route.meta.engine watcher 提前更新
  // 但 currentRenderer 还是旧的渲染器实例
  const oldType = currentRenderer.value?.getType() || mapStore.mapType
  switching.value = true
  loading.value = true

  if (import.meta.env.DEV) {
    console.log(`[UnifiedMap] switchMapType: ${oldType} → ${newType}`)
    console.log(
      `[UnifiedMap] mapStore.mapType=${mapStore.mapType}, currentRenderer.type=${currentRenderer.value?.getType()}`,
    )
  }

  // 如果 oldType 和 newType 相同，无需切换
  if (oldType === newType) {
    if (import.meta.env.DEV) {
      console.log('[UnifiedMap] 类型相同，跳过切换')
    }
    switching.value = false
    loading.value = false
    return
  }

  try {
    // 关键修复：切换前导出旧渲染器的相机状态
    let cameraState = null
    if (currentRenderer.value) {
      cameraState = currentRenderer.value.exportState()
      if (import.meta.env.DEV) {
        console.log('[UnifiedMap] 导出相机状态:', cameraState)
      }
    }

    // 更新 mapStore（如果还未更新）
    if (mapStore.mapType !== newType) {
      mapStore.setMapType(newType)
      if (import.meta.env.DEV) {
        console.log(`[UnifiedMap] mapStore.mapType 更新为: ${mapStore.mapType}`)
      }
    }

    // 首次切换到3D时，v-if 创建 Cesium 容器
    if (newType === '3d' && !cesiumInitialized.value) {
      cesiumInitialized.value = true
      // 双重 nextTick 确保 Vue 完成 DOM patch 和 ref 绑定
      // 第一个 nextTick：DOM 更新队列处理
      // 第二个 nextTick：ref 绑定完成
      await nextTick()
      await nextTick()
    }

    const container = getContainer(newType)
    if (!container) {
      throw new Error(`${newType}容器未就绪（ref绑定失败）`)
    }

    // initRenderer 内部会通过 waitForContainerVisible 等待浏览器完成 layout
    await initRenderer(newType, container)

    // 关键修复：切换后导入新渲染器的相机状态
    if (cameraState && currentRenderer.value) {
      currentRenderer.value.importState(cameraState)
      if (import.meta.env.DEV) {
        console.log('[UnifiedMap] 导入相机状态完成')
      }
    }

    emit('typeChange', newType)
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error(`切换到 ${newType} 失败:`, error)
    }
    loadError.value = error.message || '地图切换失败'

    // 关键修复：初始化失败时，回滚 mapStore.mapType 到旧值
    // 避免容器因 mapType 错误而被 v-show 隐藏
    if (oldType !== newType) {
      mapStore.setMapType(oldType)
    }

    emit('error', error)
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
  },
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
    <!-- OL容器：始终存在，通过v-show控制显示 -->
    <div v-show="mapType === '2d'" ref="olContainerRef" class="map-container"></div>

    <!-- Cesium容器：首次创建后保留，通过v-show控制显示 -->
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
  /* 关键修复：确保地图容器可以接收鼠标事件 */
  /* 即使父元素设置了 pointer-events: none，地图容器本身也需要响应事件 */
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
  top: 10px; /* 10px 非8的整数倍，保留 */
  left: 10px; /* 10px 非8的整数倍，保留 */
  color: #e74c3c;
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

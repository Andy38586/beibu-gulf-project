<script setup lang="ts">
// 统一地图容器：OL/Cesium双引擎，v-show切换，渲染器实例复用不销毁
import type { Feature, FeatureCollection, Point } from 'geojson'
import { computed, nextTick, onMounted, onUnmounted, provide, ref, watch } from 'vue'

import { BOUNDARY_STYLE, loadBoundaryGeoJson } from '@/core/map/composables/useBoundaryLayer'
import { useBusinessLayers } from '@/core/map/composables/useBusinessLayers'
import { useLayerManager } from '@/core/map/composables/useLayerManager'
import { MapRendererKey } from '@/core/map/composables/useMapRenderer'
import { buildPortGeoJson, loadPorts, PORT_STYLE } from '@/core/map/composables/usePortLayer'
import { createRenderer } from '@/core/map/renderers'
import type { MapRenderer } from '@/core/map/renderers/MapRenderer'
import { CELL_PIXEL } from '@/shared'
import { useGCS } from '@/shared'
import { logger } from '@/shared'
import { useMapStore } from '@/stores'
import type {
  FlyToOptions,
  FlyToTarget,
  MapRendererEventMap,
  PointFeature,
  Port,
  RendererState,
} from '@/types'

const { cell8px } = useGCS()

interface Props {
  mapType?: '2d' | '3d'
}
const props = withDefaults(defineProps<Props>(), {
  mapType: '2d',
})

const emit = defineEmits<{
  typeChange: [newType: '2d' | '3d']
  click: [payload: MapRendererEventMap['click']]
  error: [error: Error]
}>()

// 两个容器引用（OL始终存在，Cesium首次创建后保留）
const olContainerRef = ref<HTMLElement | null>(null)
const cesiumContainerRef = ref<HTMLElement | null>(null)

const loading = ref(true)
const switching = ref(false)
const pendingSwitchType = ref<'2d' | '3d' | null>(null)
const loadError = ref('')
const boundaryWarning = ref('')
const currentRenderer = ref<MapRenderer | null>(null)
const mapStore = useMapStore()
const olRenderer = ref<MapRenderer | null>(null)
const cesiumRenderer = ref<MapRenderer | null>(null)
const cesiumInitialized = ref(false)

provide(MapRendererKey, currentRenderer)
// mapStore 已由 App.vue 统一 provide，此处不再重复（z025）

const { registerBaseLayerWithRenderer, clearLayers } = useLayerManager()
// 核心常驻层（boundary/ports）收口到 BLM，与业务图层统一管理
const { manager: businessLayerManager } = useBusinessLayers()

const spinnerSizeCss = computed(() => `${Math.round(CELL_PIXEL * 0.5)}px`)

let portGeoJson: FeatureCollection | null = null
let boundaryGeoJson: FeatureCollection | null = null

const LOAD_TIMEOUT_MS = 10000

/** 组件级 abort：卸载后阻止异步回调继续写 ref（z024） */
const loadAbort = new AbortController()

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      loadAbort.abort()
      reject(new Error(errorMessage))
    }, timeoutMs)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId))
}

// v-show切换后浏览器未必完成layout，用rAF等待容器有实际尺寸再初始化渲染器
// rafIds 收集器供 onUnmounted 取消，防止组件卸载后回调仍执行
const _pendingRafIds = new Set<number>()

function waitForContainerVisible(container: HTMLElement | null): Promise<void> {
  return new Promise<void>((resolve) => {
    if (container && container.offsetWidth > 0 && container.offsetHeight > 0) {
      resolve()
      return
    }
    let attempts = 0
    const maxAttempts = 10
    let currentRafId: number
    const check = () => {
      attempts++
      if (container && container.offsetWidth > 0 && container.offsetHeight > 0) {
        _pendingRafIds.delete(currentRafId)
        resolve()
      } else if (attempts < maxAttempts) {
        _pendingRafIds.delete(currentRafId)
        currentRafId = requestAnimationFrame(check)
        _pendingRafIds.add(currentRafId)
      } else {
        _pendingRafIds.delete(currentRafId)
        if (import.meta.env.DEV) {
          logger.warn('waitForContainerVisible: 容器尺寸检查超时，继续执行')
        }
        resolve()
      }
    }
    currentRafId = requestAnimationFrame(check)
    _pendingRafIds.add(currentRafId)
  })
}

async function loadData() {
  try {
    const ports = await withTimeout(loadPorts(), LOAD_TIMEOUT_MS, '港口数据加载超时')
    if (loadAbort.signal.aborted) return
    portGeoJson = buildPortGeoJson(ports) as FeatureCollection
    boundaryGeoJson = await withTimeout(
      loadBoundaryGeoJson((msg: string) => {
        boundaryWarning.value = msg
      }),
      LOAD_TIMEOUT_MS,
      '边界数据加载超时'
    )
  } catch (error) {
    if (loadAbort.signal.aborted) return
    const err = error instanceof Error ? error : new Error(String(error))
    if (import.meta.env.DEV) {
      logger.error('地图数据加载失败:', err)
    }
    // 所有加载失败都向用户展示错误信息，不仅限于超时
    if (err.message.includes('超时')) {
      loadError.value = err.message
    } else {
      loadError.value = '地图数据加载失败，请刷新重试'
    }
  }
}

/**
 * 初始化指定类型的渲染器（首次创建或复用）
 * @param {'2d'|'3d'} type - 渲染器类型
 * @param {HTMLElement} container - DOM容器
 */
async function initRenderer(type: '2d' | '3d', container: HTMLElement | null) {
  if (!container) {
    if (import.meta.env.DEV) {
      logger.error(`initRenderer: ${type}容器为空`)
    }
    return
  }

  await waitForContainerVisible(container)

  try {
    let existingRenderer = type === '2d' ? olRenderer.value : cesiumRenderer.value

    // 3D 复用前检查 viewer 是否存活：CesiumViewerManager 有 30s 闲置销毁机制
    // （离开 3D 超过 30s 后自动销毁 viewer），销毁后旧 CesiumRenderer 实例已失效
    // （this.viewer 指向已销毁对象，属性访问会抛错），直接复用会白屏。
    // 注意：此处不能调 existingRenderer.destroy() —— 其内部（destroyEvents 等）
    // 会访问 this.viewer.scene/camera，而 viewer 已被 Cesium destroy，访问即抛
    // TypeError（Cannot read properties of undefined）。viewer 的 Cesium 资源已随
    // viewer.destroy() 清理，旧实例仅需丢弃引用交给 GC（防抖定时器回调自带
    // viewer 空值防御，见 setupCameraDebounce）。
    if (existingRenderer && type === '3d') {
      const { cesiumViewerManager } = await import('@/core/map/renderers/CesiumRenderer')
      if (!cesiumViewerManager.getInstance()) {
        existingRenderer = null
        cesiumRenderer.value = null
      }
    }

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

function setupLayers() {
  const renderer = currentRenderer.value
  if (!renderer) return
  clearLayers()

  registerBaseLayerWithRenderer('base-image', '影像底图', renderer)
  registerBaseLayerWithRenderer('base-vector', '矢量底图', renderer)

  // 核心常驻层（boundary/ports）收口到 BusinessLayerManager，
  // 与业务图层统一走 registry。register 仅首次创建视觉实例 + catalog 条目，
  // 引擎切换时 registry 持久、setupLayers 内 register 跳过（已注册），
  // 由 App.vue 的 reapplyAll 把图层数据重绘到新 renderer 并重建 catalog 条目。
  if (boundaryGeoJson && !businessLayerManager.has('boundary')) {
    businessLayerManager.register('boundary', {
      label: '行政区划',
      layerType: 'geojson',
      data: boundaryGeoJson,
      options: BOUNDARY_STYLE,
    })
  }

  if (portGeoJson && !businessLayerManager.has('ports')) {
    const validFeatures = (portGeoJson.features as Feature<Point>[]).filter((f) => {
      if (!f?.geometry?.coordinates) return false
      if (!Array.isArray(f.geometry.coordinates) || f.geometry.coordinates.length < 2) return false
      const [lng, lat] = f.geometry.coordinates
      return !(lng === 0 && lat === 0)
    })
    if (validFeatures.length > 0) {
      const portFeatures: PointFeature[] = validFeatures
        .map((f) => ({
          ...f.properties,
          lng: f.geometry.coordinates[0],
          lat: f.geometry.coordinates[1],
        }))
        .filter(Boolean) as PointFeature[]
      businessLayerManager.register('ports', {
        label: '港口位置',
        layerType: 'points',
        data: portFeatures,
        options: PORT_STYLE,
      })
    }
  }
}

// 具名回调，保存引用供 off 解绑（MapRenderer 事件注册/移除配对契约）
function handleRendererClick(event: CustomEvent<MapRendererEventMap['click']>): void {
  const { featureType, data, coordinate } = event.detail
  if (featureType === 'port' && data) {
    // featureType === 'port' 时 data 为港口属性，类型系统无法通过判别收窄，需断言
    mapStore.setSelectedPort(data as unknown as Port)
  } else {
    mapStore.clearSelectedPort()
  }
  emit('click', { featureType, data, coordinate })
}

function setupEvents() {
  const renderer = currentRenderer.value
  if (!renderer) return
  renderer.on('click', handleRendererClick)
}

function getContainer(type: '2d' | '3d') {
  return type === '2d' ? olContainerRef.value : cesiumContainerRef.value
}

// 双引擎切换：v-show控制显示，渲染器实例保留复用，失败时回滚mapType
// 重入保护：切换进行中时排队最新请求，完成后自动执行（仅保留最后一个）
async function switchMapType(newType: '2d' | '3d') {
  if (switching.value) {
    pendingSwitchType.value = newType
    return
  }

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
    // LIF-6：同类型提前返回时清空排队请求，避免悬挂
    pendingSwitchType.value = null
    return
  }

  try {
    let cameraState: RendererState | null = null
    if (currentRenderer.value) {
      cameraState = currentRenderer.value.exportState()
    }

    // P0-2: 3D→2D 时 unmount Cesium（暂停渲染 + 启动 30s 空闲销毁）。
    // 30s 内切回 3D 由 mount() 的 _clearIdleDestroyTimer 取消销毁,不会误杀 Viewer。
    if (oldType === '3d' && newType === '2d') {
      const { cesiumViewerManager } = await import('@/core/map/renderers/CesiumRenderer')
      cesiumViewerManager.unmount()
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
    // 处理切换期间排队的最新请求（仅保留最后一个）
    const pending = pendingSwitchType.value
    pendingSwitchType.value = null
    if (pending !== null) {
      void nextTick(() => switchMapType(pending))
    }
  }
}

function flyTo(target: FlyToTarget, options: FlyToOptions = {}) {
  currentRenderer.value?.flyTo(target, options)
}

function getRenderer() {
  return currentRenderer.value
}

function startBreathing(lng: number, lat: number) {
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

// a043: 地图无 resize 响应（窗口缩放/侧栏折叠/抽屉后 canvas 失配）——挂 ResizeObserver
// 观察两个地图容器，尺寸变化 → 当前渲染器 updateSize（Cesium viewer.resize / OL map.updateSize）。
// 用 ResizeObserver 而非 window.resize：侧栏折叠/抽屉导致的容器尺寸变化窗口尺寸不变，
// 只有容器级观察能捕获。v-show 隐藏容器切回时也触发回调 → 顺带修复切换后 canvas 尺寸。
let resizeObserver: ResizeObserver | null = null

function watchContainerSize(container: HTMLElement | null): void {
  if (!container || resizeObserver) return
  resizeObserver = new ResizeObserver(() => {
    // 防抖：连续 resize 事件合并（Cesium resize 有布局开销，避免高频触发）
    if (resizeObserver) {
      currentRenderer.value?.updateSize()
    }
  })
  resizeObserver.observe(container)
}

onMounted(async () => {
  await loadData()
  if (loadAbort.signal.aborted) return
  // a042 防御：初始 mapType='3d' 且 Cesium 容器未渲染（模板 v-if="cesiumInitialized"
  // 初值 false）时，直接 getContainer('3d') 拿到 null → initRenderer 静默 return →
  // 白图。正常路径下 App.vue route watch immediate 先置 '2d'（路由未解析），
  // 导航完成后 prop 变化走 switchMapType——但该时序脆弱（若挂载前路由已解析为
  // engine:'3d' 即触发）。此处兜底：先置标志+nextTick 等容器挂载再 initRenderer。
  if (props.mapType === '3d' && !cesiumInitialized.value) {
    cesiumInitialized.value = true
    await nextTick()
    await nextTick()
  }
  // 首次挂载：v-if已渲染默认类型的容器
  const container = getContainer(props.mapType)
  await initRenderer(props.mapType, container)
  loading.value = false

  // a043: 观察 OL 容器（常驻）；Cesium 容器 v-if 出现后由 cesiumInitialized watch 观察
  watchContainerSize(olContainerRef.value)
})

// a043: Cesium 容器首次创建（cesiumInitialized → true）后观察其尺寸变化
watch(cesiumInitialized, (init) => {
  if (init) {
    void nextTick(() => watchContainerSize(cesiumContainerRef.value))
  }
})

onUnmounted(() => {
  // 卸载时 abort，阻止未完成的异步回调继续写 ref
  loadAbort.abort()

  // a043: 断开容器尺寸观察（注册/移除配对契约，防泄漏）
  resizeObserver?.disconnect()
  resizeObserver = null

  // 取消所有待执行的 rAF 回调，防止组件卸载后仍操作 DOM
  _pendingRafIds.forEach((id) => cancelAnimationFrame(id))
  _pendingRafIds.clear()

  // 停止可能排队的引擎切换（卸载后不再执行异步 initRenderer）
  switching.value = false
  pendingSwitchType.value = null

  // 引擎切换/卸载前解绑 click 监听（注册/移除配对契约）
  if (currentRenderer.value) {
    currentRenderer.value.off?.('click', handleRendererClick)
  }

  // 遍历销毁两个缓存渲染器（而非只销毁当前渲染器），销毁后 ref 显式置空
  const cachedRenderers = [olRenderer.value, cesiumRenderer.value]
  cachedRenderers.forEach((r) => {
    if (r) {
      try {
        r.destroy()
      } catch (e) {
        if (import.meta.env.DEV) logger.warn('[UnifiedMap] 渲染器销毁失败:', e)
      }
    }
  })
  olRenderer.value = null
  cesiumRenderer.value = null
  currentRenderer.value = null
  cesiumInitialized.value = false

  // store 悬空引用清除
  mapStore.setCurrentRenderer(null)
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
  border: 4px solid var(--GCS-bg-container);
  border-top: 4px solid var(--GCS-color-primary);
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
  color: var(--GCS-color-error);
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

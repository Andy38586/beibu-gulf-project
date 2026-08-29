<script setup lang="ts">
// 统一地图容器：OL/Cesium双引擎，v-show切换，渲染器实例复用不销毁
import type { Feature, FeatureCollection, Point } from 'geojson'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import MapFeatureBubble from '@/core/map/components/MapFeatureBubble.vue'
import { BOUNDARY_STYLE, loadBoundaryGeoJson } from '@/core/map/composables/useBoundaryLayer'
import { useBusinessLayers } from '@/core/map/composables/useBusinessLayers'
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
  // 816-专项3-0816-16：事件名改 kebab-case（03 1.2 命名约定；原 typeChange camelCase）
  'type-change': [newType: '2d' | '3d']
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

// ── 要素气泡（2D）：悬浮即显移开即隐，点击钉住并随 POI 跟随；同一时刻仅一个 ──
const bubblePinned = ref<Port | null>(null)
const bubbleHover = ref<Port | null>(null)
const bubbleAnchor = ref<[number, number] | null>(null)
const bubbleHostRef = ref<HTMLElement | null>(null)
const bubblePort = computed<Port | null>(() => bubblePinned.value ?? bubbleHover.value)
const bubbleVisible = computed(() => bubblePort.value !== null)

// 显隐/锚点同步给渲染器 Overlay（OL 随地图移动自动跟随；3D 无此能力，可选链跳过）
watch([bubbleVisible, bubbleAnchor], ([visible, anchor]) => {
  currentRenderer.value?.setBubbleAnchor?.(visible ? anchor : null)
})

function closeBubble(): void {
  bubblePinned.value = null
  bubbleHover.value = null
}

// mapStore 已由 App.vue 统一 provide，此处不重复

// 底图注册走 mapStore.registerBaseLayer（互斥切换由 setBaseLayer + baseLayerKey 管理）；
// 核心常驻层（boundary/ports）收口到业务图层管理器（BLM），与业务图层统一管理
const { manager: businessLayerManager } = useBusinessLayers()

const spinnerSizeCss = computed(() => `${Math.round(CELL_PIXEL * 0.5)}px`)

let portGeoJson: FeatureCollection | null = null
let boundaryGeoJson: FeatureCollection | null = null

const LOAD_TIMEOUT_MS = 10000

/** 组件级 abort：卸载后阻止异步回调继续写 ref（仅卸载/切换时 abort，超时不得全局 abort——
 *  曾因 withTimeout 超时误 abort 导致后续加载全部静默失效且错误提示被吞） */
const loadAbort = new AbortController()

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
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

/** 数据加载：ports（后端 API）与 boundary（静态文件）并行加载、独立失败——
 *  曾串行 await 使 ports 失败阻断 boundary 加载（后端未起时行政区也出不来），
 *  且双 /api 前缀导致 /api/ports 请求 404（useApiRequest 已修，见该文件注释）。
 *  boundary 内部自带 3 次退避重试；ports 走 apiRequest（内部重试）——此处不再叠加外层重试；
 *  boundary 链路透传 loadAbort.signal——卸载即取消 fetch/跳过续试，
 *  结果消费前仍由 aborted 守卫拦截 */
async function loadData() {
  const [portsResult, boundaryResult] = await Promise.allSettled([
    withTimeout(loadPorts(), LOAD_TIMEOUT_MS, '港口数据加载超时'),
    withTimeout(
      loadBoundaryGeoJson((msg: string) => {
        boundaryWarning.value = msg
      }, loadAbort.signal),
      LOAD_TIMEOUT_MS,
      '边界数据加载超时'
    ),
  ])
  if (loadAbort.signal.aborted) return

  if (portsResult.status === 'fulfilled') {
    portGeoJson = buildPortGeoJson(portsResult.value) as FeatureCollection
  } else {
    const err =
      portsResult.reason instanceof Error
        ? portsResult.reason
        : new Error(String(portsResult.reason))
    if (import.meta.env.DEV) {
      logger.error('港口数据加载失败:', err)
    }
    loadError.value = err.message.includes('超时')
      ? err.message
      : '港口图层加载失败，请检查后端服务'
  }

  if (boundaryResult.status === 'fulfilled' && boundaryResult.value) {
    boundaryGeoJson = boundaryResult.value
  } else if (boundaryResult.status === 'rejected') {
    const err =
      boundaryResult.reason instanceof Error
        ? boundaryResult.reason
        : new Error(String(boundaryResult.reason))
    if (import.meta.env.DEV) {
      logger.error('边界数据加载失败:', err)
    }
    loadError.value = err.message.includes('超时') ? err.message : '行政区划图层加载失败'
  }

  // 数据就绪后补一次 setupLayers：boundary/ports 注册依赖数据已加载，
  // 若路由/引擎切换先于 loadData 执行会跳过注册导致图层缺失；补注册幂等
  if (currentRenderer.value) {
    void nextTick(() => setupLayers())
  }
}

/** 初始化指定类型的渲染器（首次创建或复用） */
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

    // 3D 复用前检查 viewer 是否存活：闲置超时销毁后旧渲染器实例已失效，直接复用会白屏。
    // 不调 destroy()——viewer 已被 Cesium 销毁，destroy 内部访问 this.viewer 会抛错；
    // 丢弃引用交给 GC 即可
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

      if (type === '3d') {
        const { cesiumViewerManager } = await import('@/core/map/renderers/CesiumRenderer')
        cesiumViewerManager.mount(container)
      }

      existingRenderer.updateSize()
      // 顺序关键：先 setCurrentRenderer（setupLayers 的底图重放依赖 mapStore.currentRenderer），
      // 再 setupLayers（含底图重放），最后 reapplyAll 重建业务图层——顺序反了面板与屏幕脱节
      mapStore.setCurrentRenderer(existingRenderer)
      setupLayers()
      businessLayerManager.reapplyAll(existingRenderer)
    } else {
      const renderer = (await createRenderer(type, container)) as unknown as MapRenderer

      if (type === '2d') {
        olRenderer.value = renderer
      } else {
        cesiumRenderer.value = renderer
      }

      currentRenderer.value = renderer
      // 顺序关键：setCurrentRenderer 必须先于 setupLayers（底图重放读 mapStore.currentRenderer），
      // 否则首次进引擎时底图指令发射给 null/旧实例，屏幕保持默认底图而面板显示新选择
      mapStore.setCurrentRenderer(renderer)
      renderer.updateSize()
      setupLayers()
      setupEvents()
      // 气泡宿主挂给 OL Overlay（元素由本组件模板提供；3D 渲染器无此能力跳过）
      if (type === '2d' && bubbleHostRef.value) {
        renderer.attachBubbleElement?.(bubbleHostRef.value)
      }
      businessLayerManager.reapplyAll(renderer)
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    if (import.meta.env.DEV) {
      logger.error(`Renderer ${type} 初始化失败:`, err)
    }
    loadError.value = err.message || '地图初始化失败'
    emit('error', err)
    // 上抛给 switchMapType 统一回滚（mapType + currentRenderer）；吞错会导致
    // UI 已切新引擎但渲染器仍是旧实例的撕裂态
    throw err
  }
}

// 每次切换引擎时重建图层目录（绑定当前渲染器实例）

function setupLayers() {
  const renderer = currentRenderer.value
  if (!renderer) return
  // 先清空图层目录，再按当前引擎重建
  mapStore.clearLayerCatalog()

  // 底图条目仅建目录（互斥切换由 setBaseLayer + baseLayerKey 管理）
  mapStore.registerBaseLayer('base-image', '影像底图')
  mapStore.registerBaseLayer('base-vector', '矢量底图')

  // 底图初始化：统一经 mapStore.setBaseLayer 写回权威键并驱动渲染器——
  // 直接 setBaseLayer 给渲染器而不写回 store，会让图层控制面板的互斥判定
  // 全部落空（baseLayerKey 为 null 时两个底图按钮都不亮）
  mapStore.setBaseLayer(mapStore.baseLayerKey ?? 'base-image')

  // 核心常驻层（boundary/ports）走业务图层管理器统一注册；
  // 引擎切换时 registry 持久、此处注册幂等跳过，由 reapplyAll 重绘到新渲染器
  logger.debug(
    `[UnifiedMap] setupLayers: boundaryGeoJson=${!!boundaryGeoJson} hasBoundary=${businessLayerManager.has('boundary')} portGeoJson=${!!portGeoJson} hasPorts=${businessLayerManager.has('ports')}`
  )
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

// 816-专项3-0816-09：类型谓词替代双重断言——featureType==='port' 时 data 应为港口属性，
// 谓词做运行期最小形状校验（判别来源：usePortLayer properties = {...port, featureType}）
function isPortEventData(data: unknown): data is Port {
  if (!data || typeof data !== 'object') return false
  const p = data as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.lng === 'number' &&
    typeof p.lat === 'number'
  )
}

// 具名回调，保存引用供 off 解绑（MapRenderer 事件注册/移除配对契约）
function handleRendererClick(event: CustomEvent<MapRendererEventMap['click']>): void {
  const { featureType, data, coordinate } = event.detail
  if (featureType === 'port' && data && isPortEventData(data) && props.mapType === '2d') {
    // 气泡钉住/撤销：同 POI 再点关闭，其他 POI 切换（锚点取 POI 自身经纬度，精确跟随）
    if (bubblePinned.value && bubblePinned.value.id === data.id) {
      closeBubble()
    } else {
      bubblePinned.value = data
      bubbleAnchor.value = [data.lng, data.lat]
    }
  } else {
    // 空白/非港口要素/3D（无气泡能力）：关闭气泡
    closeBubble()
  }
  emit('click', { featureType, data, coordinate })
}

/** 悬停驱动气泡：命中港口即显、移开即隐；钉住时悬浮不打扰当前气泡 */
function handleRendererHover(event: CustomEvent<MapRendererEventMap['hover']>): void {
  if (bubblePinned.value) return
  const { featureType, data } = event.detail
  if (featureType === 'port' && data && isPortEventData(data)) {
    bubbleHover.value = data
    bubbleAnchor.value = [data.lng, data.lat]
  } else {
    bubbleHover.value = null
  }
}

function setupEvents() {
  const renderer = currentRenderer.value
  if (!renderer) return
  renderer.on('click', handleRendererClick)
  renderer.on('hover', handleRendererHover)
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
  // 气泡是 2D Overlay 能力，引擎切换即收（3D 无跟随能力）
  closeBubble()

  logger.debug(`[UnifiedMap] switchMapType: ${oldType} → ${newType}`)
  logger.debug(
    `[UnifiedMap] mapStore.mapType=${mapStore.mapType}, currentRenderer.type=${currentRenderer.value?.getType()}`
  )

  // 如果 oldType 和 newType 相同，无需切换
  if (oldType === newType) {
    logger.debug('[UnifiedMap] 类型相同，跳过切换')
    switching.value = false
    loading.value = false
    // 同类型提前返回时清空排队请求，避免悬挂
    pendingSwitchType.value = null
    return
  }

  try {
    let cameraState: RendererState | null = null
    if (currentRenderer.value) {
      cameraState = currentRenderer.value.exportState()
    }

    // 3D→2D 时先停呼吸灯 rAF（挂在 Cesium 渲染器上，不停止会泄漏动画循环），再 unmount Cesium
    //（暂停渲染 + 启动闲置销毁；短时切回由 mount 取消销毁）
    if (oldType === '3d' && newType === '2d') {
      currentRenderer.value?.stopBreathing()
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

    emit('type-change', newType)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    if (import.meta.env.DEV) {
      logger.error(`切换到 ${newType} 失败:`, err)
    }
    loadError.value = err.message || '地图切换失败'

    // 初始化失败时回滚 mapStore.mapType 与 currentRenderer（含 store 悬空引用），
    // 避免 v-show 容器与渲染器实例类型撕裂
    if (oldType !== newType) {
      mapStore.setMapType(oldType)
      const fallback = oldType === '2d' ? olRenderer.value : cesiumRenderer.value
      if (fallback && currentRenderer.value !== fallback) {
        currentRenderer.value = fallback
        mapStore.setCurrentRenderer(fallback)
      }
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

// 监听 mapType 变化触发切换；两引擎容器常驻（v-show），渲染器实例保留复用
watch(
  () => props.mapType,
  async (newType) => {
    await switchMapType(newType)
  }
)

// 挂 ResizeObserver 观察地图容器尺寸变化（侧栏折叠/抽屉后 canvas 失配）：
// 窗口尺寸可能不变，只有容器级观察能捕获；v-show 切回时同样触发，顺带修复 canvas 尺寸
let resizeObserver: ResizeObserver | null = null

function watchContainerSize(container: HTMLElement | null): void {
  // 防御：环境不支持 ResizeObserver（jsdom/老浏览器）时静默跳过，避免反复重试报错
  if (!container || resizeObserver || typeof ResizeObserver === 'undefined') return
  try {
    resizeObserver = new ResizeObserver(() => {
      // 容器尺寸变化 → 当前渲染器 updateSize（Cesium resize 有布局开销）
      if (resizeObserver) {
        currentRenderer.value?.updateSize()
      }
    })
    resizeObserver.observe(container)
  } catch {
    // 构造/观察失败（个别环境）→ 复位并退出，下次触发仍可重试，但不抛错
    resizeObserver = null
  }
}

onMounted(async () => {
  await loadData()
  if (loadAbort.signal.aborted) return
  // 兜底：初始 3D 时容器尚未渲染（v-if 依赖 cesiumInitialized），
  // 先置标志并等 nextTick 让容器挂载后再初始化，避免白图
  if (props.mapType === '3d' && !cesiumInitialized.value) {
    cesiumInitialized.value = true
    await nextTick()
    await nextTick()
  }
  // 首次挂载：v-if已渲染默认类型的容器
  const container = getContainer(props.mapType)
  try {
    await initRenderer(props.mapType, container)
  } catch {
    // initRenderer 内部已 emit('error') + 设置 loadError；rethrow 仅服务 switchMapType 回滚，
    // 首次挂载路径无回滚目标，此处吞掉防止 mounted hook unhandled rejection
  }
  loading.value = false

  // 观察 OL 容器（常驻）；Cesium 容器由下方 watch 在出现后观察
  watchContainerSize(olContainerRef.value)
})

// Cesium 容器首次创建（cesiumInitialized → true）后观察其尺寸变化
watch(cesiumInitialized, (init) => {
  if (init) {
    void nextTick(() => watchContainerSize(cesiumContainerRef.value))
  }
})

onUnmounted(() => {
  // 卸载时 abort，阻止未完成的异步回调继续写 ref
  loadAbort.abort()

  // 断开容器尺寸观察（注册/移除配对契约，防泄漏）
  resizeObserver?.disconnect()
  resizeObserver = null

  // 取消所有待执行的 rAF 回调，防止组件卸载后仍操作 DOM
  _pendingRafIds.forEach((id) => cancelAnimationFrame(id))
  _pendingRafIds.clear()

  // 停止可能排队的引擎切换（卸载后不再执行异步 initRenderer）
  switching.value = false
  pendingSwitchType.value = null

  // 引擎切换/卸载前解绑 click 监听（注册/移除配对契约；两个缓存渲染器都解绑，
  // 仅解绑当前渲染器会在复用旧实例时残留监听）
  ;[olRenderer.value, cesiumRenderer.value].forEach((r) => {
    r?.off?.('click', handleRendererClick)
  })

  // 遍历销毁两个缓存渲染器（而非只销毁当前渲染器），销毁后 ref 显式置空
  const cachedRenderers = [olRenderer.value, cesiumRenderer.value]
  cachedRenderers.forEach((r) => {
    if (r) {
      try {
        if (r === cesiumRenderer.value) {
          // Cesium 常规卸载走 destroy（内部为保留 Viewer 复用的卸载语义 + 30s 空闲销毁窗口）；
          // 类上无 unmount 方法，误调是 no-op，事件清理/水面清理/空闲销毁定时器全部跳过，WebGL 永久泄漏
          r.destroy()
        } else {
          // OL 无复用设计，正常销毁
          r.destroy()
        }
      } catch (e) {
        if (import.meta.env.DEV) logger.warn('[UnifiedMap] 渲染器卸载失败:', e)
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

    <!-- 要素气泡（2D）：宿主元素交给 OL Overlay 定位，悬浮/钉住共用，同一时刻仅一个 -->
    <div v-show="bubbleVisible" ref="bubbleHostRef" class="map-bubble-host">
      <MapFeatureBubble
        v-if="bubblePort"
        :port="bubblePort"
        :pinned="bubblePinned !== null"
        @close="closeBubble"
      />
    </div>

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
  z-index: var(--GCS-z-map);
}

.map-container {
  width: 100%;
  height: 100%;
  transition: opacity 0.3s ease;

  /* 确保地图容器可以接收鼠标事件，即使父元素设置了 pointer-events: none */
  pointer-events: auto;
}

.map-bubble-host {
  /* 定位由 OL Overlay 接管（绝对定位于地图容器内），此层只承载气泡内容与交互 */
  pointer-events: auto;
}

.map-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;

  /* S7 P1-1：硬编码白遮罩 → 面板半透明 token（暗色随主题变深蓝，不再亮白刺眼） */
  background: var(--GCS-bg-panel-translucent);
  z-index: var(--GCS-z-map-status);
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

  /* S7 P1-1：硬编码白底 → 浮层背景 token（暗色随主题） */
  background: var(--GCS-bg-elevated);
  padding: v-bind(cell8px) 12px; /* 12px 非8的整数倍，保留 */
  border-radius: 6px;
  z-index: var(--GCS-z-map-status);
}

.boundary-warning {
  position: absolute;
  bottom: 10px; /* 10px 非8的整数倍，保留 */
  left: 10px; /* 10px 非8的整数倍，保留 */

  /* S7 P1-1：硬编码黄 → 语义警告色 token（暗色下柔和橙替代刺眼亮黄） */
  background: var(--GCS-color-warning);
  padding: 6px 12px; /* 6px/12px 非8的整数倍，保留（816-S7-51 复核：已登记取舍项） */
  border-radius: 6px;
  font-size: 13px;
  z-index: var(--GCS-z-map-overlay);
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

# Beibu Gulf WebGIS - 完整代码汇总

> 生成时间: 2026-07-24T11:55:23.475Z
> 前端文件: 79 个
> 后端文件 (接口层): 24 个

---

## 入口与配置

## src/App.vue

```vue
<script setup>
import { RouterView, useRoute, useRouter } from 'vue-router''
import { onMounted, provide, ref, watch } from ''vue''
import UnifiedMap from ''@/core/map/UnifiedMap.vue''
import ErrorBoundary from ''@/shared/components/ErrorBoundary.vue''
import { useAuth } from ''@/shared/composables/useAuth''
import { useMapControls } from ''@/core/map/composables/useMapControls''
import { useMapStore } from ''@/stores/map''
import { BusinessLayerManager } from ''@/core/map/BusinessLayerManager''
import { BUSINESS_LAYER_MANAGER_KEY } from ''@/core/map/composables/useBusinessLayers''
import { logger } from ''@/shared/utils/logger''

const route = useRoute()
const router = useRouter()
const { restoreAuth } = useAuth()
const { zoomToRegion, zoomToCity, stopBreathing } = useMapControls()
const mapStore = useMapStore()

const unifiedMapRef = ref(null)
const restorePlanData = ref(null)
const editingPlan = ref(null)

provide(''restorePlanData'', restorePlanData)
provide(''editingPlan'', editingPlan)
provide(''unifiedMap'', unifiedMapRef)
// 提供 mapStore 给所有子组件（含 UnifiedMap 和 RouterView 下的业务页面）
provide(''mapStore'', mapStore)

// 提供 BusinessLayerManager — 必须在 App.vue 而非 UnifiedMap，
// 因为 RouterView 下的业务组件是 UnifiedMap 的兄弟节点，不是子节点
const businessLayerManager = new BusinessLayerManager(mapStore)
provide(BUSINESS_LAYER_MANAGER_KEY, businessLayerManager)

function handleRequireLogin() {
  router.push(''/profile'')
}

// P1-001-FIX: 等待渲染器就绪后再执行缩放
function waitForRenderer(callback, retries = 0) {
  const renderer = unifiedMapRef.value?.getRenderer?.()
  if (renderer) {
    callback()
  } else if (retries < 10) {
    setTimeout(() => waitForRenderer(callback, retries + 1), 500)
  }
}

/**
 * 合并路由监听器：统一处理路由变化和地图引擎切换
 *
 * 关键修复：避免 route.name watcher 在引擎切换时覆盖 importState 设置的相机位置
 * 通过检测 meta.engine 是否变化来区分"路由导航"和"引擎切换"
 */
watch(
  () => ({
    name: route.name,
    engine: route.meta?.engine,
  }),
  (newRoute, oldRoute) => {
    stopBreathing()

    // 检测是否是引擎切换场景（engine 发生变化）
    const isEngineSwitch =
      oldRoute?.engine && newRoute.engine && oldRoute.engine !== newRoute.engine

    logger.debug(''[App.vue] route watcher triggered:'', {
      newName: newRoute.name,
      oldName: oldRoute?.name,
      newEngine: newRoute.engine,
      oldEngine: oldRoute?.engine,
      isEngineSwitch,
    })

    // 更新地图引擎类型
    if (newRoute.engine && [''2d'', ''3d''].includes(newRoute.engine)) {
      mapStore.setMapType(newRoute.engine)
    }

    // 关键修复：仅在非引擎切换场景下执行相机重置
    // 引擎切换时，相机位置由 UnifiedMap 的 importState 管理
    if (!isEngineSwitch) {
      if (newRoute.name === ''Home'') {
        waitForRenderer(zoomToRegion)
      }
      if (newRoute.name === ''SiteSelection'') {
        waitForRenderer(zoomToCity)
      }
    } else {
      logger.debug(''[App.vue] 引擎切换场景，跳过相机重置（由 importState 管理）'')
    }
  },
  { immediate: true },
)

onMounted(() => {
  // P1-002-FIX: 应用启动时恢复认证状态
  // 通过 /api/auth/me 验证 Cookie 中的 Token 是否有效
  restoreAuth()
})
</script>

<template>
  <div class="app-layout">
    <UnifiedMap ref="unifiedMapRef" :map-type="mapStore.mapType" />
    <main class="app-content">
      <ErrorBoundary>
        <RouterView v-slot="{ Component }">
          <component :is="Component" @require-login="handleRequireLogin" />
        </RouterView>
      </ErrorBoundary>
    </main>
  </div>
</template>

<style scoped>
.app-layout {
  position: relative;
  height: 100vh;
}
.app-content {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  pointer-events: none;
  z-index: 50;
}
/* 注意：不能在这里设置 .app-content > * { pointer-events: auto } */
/* 原因：这会让 .flood-analysis-page 等业务页面也变成 pointer-events: auto， */
/* 导致整个页面成为全屏事件拦截层，阻挡下层地图容器的鼠标事件（拖拽/缩放/旋转失效） */
/* 正确做法：由各业务页面自行控制 pointer-events，面板通过 AppLayout 的 .app-layout > * 恢复 */
</style>
```

## src/core/config/map.js

```javascript
const TIANDITU_KEY = import.meta.env.VITE_TIANDITU_KEY
if (!TIANDITU_KEY) {
  console.error('[map/config] 缺少 VITE_TIANDITU_KEY 环境变量，天地图底图将无法加载'')
}

export const MAP_CONFIG = {
  TIANDITU_KEY,
  BASE_LAYERS: {
    image: {
      name: ''影像底图'',
      layers: [''img_w'', ''cia_w''],
    },
    vector: {
      name: ''矢量底图'',
      layers: [''vec_w'', ''cva_w''],
    },
  },
  TIANDITU_URL: ''https://t0.tianditu.gov.cn/DataServer?T={layerCode}&x={x}&y={y}&l={z}&tk={key}'',
  DATA_PATHS: {
    ports: ''/data/ports.json'',
    boundary: ''/beibu-gulf-merged-data.geojson'',
  },
  CAMERA: {
    center: { lng: 108.5752963, lat: 21.760409, height: 10000 },
    heading: 0,
    pitch: -60,
    roll: 0,
  },
  VIEW_LEVELS: {
    REGION: {
      center: { lng: 108.5752963, lat: 21.760409 },
      height: 800000,
      zoom: 9,
      label: ''北部湾区域'',
    },
    CITY: {
      center: { lng: 108.61, lat: 21.94 },
      height: 80000,
      zoom: 12,
      label: ''钦州市'',
    },
    DISTRICT: {
      center: { lng: 108.61, lat: 21.94 },
      height: 8000,
      zoom: 14,
      label: ''区级'',
    },
  },
}

export function buildTiandituUrl(layerCode) {
  return MAP_CONFIG.TIANDITU_URL.replace(''{layerCode}'', layerCode).replace(
    ''{key}'',
    MAP_CONFIG.TIANDITU_KEY,
  )
}

/**
 * 相机 zoom ↔ height 互逆转换
 *
 * zoom↔height 经验公式（基于 MAP_CONFIG.VIEW_LEVELS 校准）：
 *   height = 300000000 / 2^zoom
 *   zoom   = log2(300000000 / height)
 *
 * zoom=9  → 585938m ≈ 586km (接近 REGION 的 800km)
 * zoom=12 → 73242m  ≈ 73km  (接近 CITY 的 80km)
 * zoom=14 → 18311m  ≈ 18km  (接近 DISTRICT 的 8km)
 */

/** zoom → height（OL → Cesium） */
export function zoomToHeight(zoom) {
  return 300000000 / Math.pow(2, zoom)
}

/** height → zoom（Cesium → OL） */
export function heightToZoom(height) {
  const safeHeight = Math.max(200, height)
  return Math.log2(300000000 / safeHeight)
}
```

## src/core/layout/config.js

```javascript
export const CELL_PIXEL = 80

// GAP = 10 是 PANEL_SPACING 和 CELL_PADDING 的派生源（V2 从 20 改为 10）
export const GAP = 10
export const CELL_PADDING = GAP
export const PANEL_SPACING = GAP * 2
export const SAFE_MARGIN = PANEL_SPACING
export const GRID_SIZE = 100

export function getCellPixelByViewport(width) {
  if (width >= 1920) return 90
  if (width >= 1366) return 80
  if (width >= 1024) return 80
  if (width >= 768) return 70
  return 60
}
```

## src/main.js

```javascript
import { createApp } from 'vue''
import App from ''./App.vue''
import router from ''./router''
import { createPinia } from ''pinia''
import ElementPlus from ''element-plus''
import ''element-plus/dist/index.css''
import ''./style.css''

// FIX:316: ResizeObserver polyfill for Safari < 13.1
if (typeof window !== ''undefined'' && !(''ResizeObserver'' in window)) {
  // 动态导入 polyfill
  import(''resize-observer-polyfill'').then(({ default: ResizeObserverPolyfill }) => {
    window.ResizeObserver = ResizeObserverPolyfill
  }).catch(() => {
    console.warn(''ResizeObserver polyfill 加载失败，部分响应式布局可能不可用'')
  })
}

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(ElementPlus)

// FIX:014 (错误): 全局错误处理，给用户反馈
app.config.errorHandler = (err, instance, info) => {
  console.error(''[Global Error]'', err, info)
  // 在开发环境显示详细错误，生产环境显示友好提示
  if (import.meta.env.DEV) {
    console.error(''错误详情:'', { err, instance, info })
  } else {
    // 可以集成错误上报服务（如 Sentry）
    // reportErrorToService(err, info)
  }
}

app.mount(''#app'')
```

## src/router/index.js

```javascript
import { createRouter, createWebHistory } from 'vue-router''

const routes = [
  {
    path: ''/'',
    name: ''Home'',
    component: () => import(''@/views/HomePage.vue''),
    meta: { engine: ''2d'', title: ''北部湾智慧港口平台'' },
  },
  // Phase 4-B：路径从 /buffer 调整为 /site-selection
  {
    path: ''/site-selection'',
    name: ''SiteSelection'',
    component: () => import(''@/business/site-selection/SiteSelectionPage.vue''),
    meta: { engine: ''2d'', title: ''选址分析'' },
  },
  // TODO:2.1b: 新增预测分析路由
  {
    path: ''/forecast'',
    name: ''Forecast'',
    component: () => import(''@/business/forecast/ForecastPage.vue''),
    meta: { engine: ''2d'', title: ''预测分析'' },
  },
  // Flood分析路由（原GCS分析），复用原热力图路由路径
  {
    path: ''/heatmap'',
    name: ''FloodAnalysis'',
    component: () => import(''@/business/flood-analysis/FloodAnalysisPage.vue''),
    meta: { engine: ''3d'', title: ''浸没分析'' },
  },
  // P0-001-FIX: 移除 requiresAuth，允许未登录用户访问登录面板
  {
    path: ''/profile'',
    name: ''Profile'',
    component: () => import(''@/views/ProfilePage.vue''),
    meta: { engine: ''2d'', title: ''个人中心'' },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// FIX:P3-12: 删除路由守卫死代码。四条路由 meta 均无 requiresAuth（P0-001 已移除），beforeEach 永不触发。
export default router
```

## 核心渲染器

## src/core/map/renderers/CesiumRenderer.js

```javascript
import { MapRenderer } from './MapRenderer''
import {
  Viewer,
  Cartesian3,
  Cartesian2,
  Color,
  PolygonHierarchy,
  UrlTemplateImageryProvider,
  Math as CesiumMath,
  ScreenSpaceEventType,
  GeoJsonDataSource,
  Cartographic,
  CallbackProperty,
  Primitive,
  PolygonGeometry,
  PerInstanceColorAppearance,
  GeometryInstance,
  ColorGeometryInstanceAttribute,
  PointGraphics,
} from ''cesium''
import { MAP_CONFIG, buildTiandituUrl, zoomToHeight } from ''@/core/config/map''
import { logger } from ''@/shared/utils/logger''

// CesiumViewer单例：全局唯一Viewer，按需mount/unmount复用，30s空闲自动销毁
class CesiumViewerManager {
  constructor() {
    this.viewer = null
    this.isMounted = false
    this._baseLayersInitialized = false
    this._idleDestroyTimer = null
    this.IDLE_DESTROY_DELAY = 30000
    this._baseLayers = { image: [], vector: [] }
  }

  // 首次创建Viewer，后续调用返回已有实例
  create(container) {
    this._clearIdleDestroyTimer()

    if (this.viewer) {
      return this.viewer
    }

    this.viewer = new Viewer(container, {
      baseLayer: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      timeline: false,
      animation: false,
      creditContainer: document.createElement(''div''),
      // 禁用 requestRenderMode，让场景在可见时持续渲染以支持拖拽交互
      // 仅在 unmount 时启用 requestRenderMode 暂停渲染降低 GPU 占用
      requestRenderMode: false,
      maximumRenderTimeChange: Infinity,
    })

    this.isMounted = true
    return this.viewer
  }

  mount(el) {
    if (!this.viewer) {
      return false
    }

    if (!el) {
      return false
    }

    // 清除空闲销毁定时器（用户回来了）
    this._clearIdleDestroyTimer()

    const viewerContainer = this.viewer.container

    // 如果 viewerContainer 就是 el 本身，说明已经在正确位置
    if (viewerContainer === el) {
      this.isMounted = true
      this.viewer.resize()
      this.viewer.scene.requestRenderMode = false
      this.viewer.scene.requestRender()
      this._enableCameraControls()
      return true
    }

    // 如果 viewerContainer 的父节点不是 el，需要移动到新容器
    if (viewerContainer && viewerContainer.parentNode !== el) {
      el.appendChild(viewerContainer)
    }

    // 关键修复：无论是否移动了DOM，都重置状态确保交互正常
    // 防止复用时之前的 unmount 状态影响交互
    this.isMounted = true
    this.viewer.resize()
    // 恢复持续渲染模式
    this.viewer.scene.requestRenderMode = false
    this.viewer.scene.requestRender()
    // 确保相机控制器的交互能力正常（拖拽、旋转、缩放等）
    this._enableCameraControls()

    return true
  }

  /**
   * 启用相机控制器的所有交互能力
   *
   * 确保拖拽、旋转、缩放、倾斜等交互可用。
   * 在首次创建和每次挂载时调用，防止状态被意外修改。
   */
  _enableCameraControls() {
    if (!this.viewer) return
    const controller = this.viewer.scene.screenSpaceCameraController
    controller.enableRotate = true
    controller.enableTranslate = true
    controller.enableZoom = true
    controller.enableTilt = true
    controller.enableLook = true
  }

  /**
   * 从DOM移除（不销毁Viewer，保留状态）
   * 隐藏时启用requestRenderMode暂停渲染，降低GPU占用
   * 同时启动30秒空闲销毁定时器
   */
  unmount() {
    if (!this.viewer || !this.isMounted) {
      return
    }

    const viewerContainer = this.viewer.container
    if (viewerContainer && viewerContainer.parentNode) {
      viewerContainer.parentNode.removeChild(viewerContainer)
      this.isMounted = false
      // 暂停渲染，降低GPU占用
      this.viewer.scene.requestRenderMode = true
      // 启动空闲销毁定时器（30秒后自动销毁释放内存）
      this._startIdleDestroyTimer()
    }
  }

  /**
   * 启动空闲销毁定时器
   * 30秒后自动销毁Viewer实例，释放内存
   */
  _startIdleDestroyTimer() {
    this._clearIdleDestroyTimer()
    this._idleDestroyTimer = setTimeout(() => {
      logger.debug(''[CesiumViewerManager] 30秒空闲，自动销毁Viewer释放内存'')
      this.destroy()
    }, this.IDLE_DESTROY_DELAY)
  }

  /**
   * 清除空闲销毁定时器
   */
  _clearIdleDestroyTimer() {
    if (this._idleDestroyTimer) {
      clearTimeout(this._idleDestroyTimer)
      this._idleDestroyTimer = null
    }
  }

  getInstance() {
    return this.viewer
  }

  isBaseLayersInitialized() {
    return this._baseLayersInitialized
  }

  /**
   * 标记底图已初始化
   */
  markBaseLayersInitialized() {
    this._baseLayersInitialized = true
  }

  /**
   * 真正销毁Viewer（一般不调用）
   */
  destroy() {
    if (this.viewer) {
      this.unmount()
      this.viewer.destroy()
      this.viewer = null
      this._baseLayersInitialized = false
    }
  }
}

// 全局单例管理器
export const cesiumViewerManager = new CesiumViewerManager()

/**
 * CesiumRenderer - Cesium三维渲染器
 *
 * 基于单例缓存+按需挂载策略：
 * - 首次进入3D路由时创建Viewer
 * - 离开3D路由时unmount（不销毁）
 * - 再次进入时mount复用，状态保留
 */
export class CesiumRenderer extends MapRenderer {
  constructor(container) {
    super(container)
    this.viewer = null
    this.baseLayers = { image: [], vector: [] }
    this._isReusing = false // 标记是否复用已有Viewer
    this._cameraDebounceTimer = null // 相机变化防抖定时器
    this._initViewer()
  }

  _initViewer() {
    // 检查是否已有Viewer实例（复用场景）
    const existingViewer = cesiumViewerManager.getInstance()
    this._isReusing = !!existingViewer

    // 通过单例管理器创建或获取Viewer
    this.viewer = cesiumViewerManager.create(this.container)

    // 关键修复：复用场景下，需要显式调用mount挂载到新容器
    // 因为create()在viewer已存在时直接返回，不会自动mount
    if (this._isReusing) {
      cesiumViewerManager.mount(this.container)
    }

    // 首次创建时才初始化场景
    if (!this._isReusing) {
      this._positionCamera()
      this._initBaseLayers()
    } else {
      // 复用时从单例管理器获取底图引用
      this.baseLayers = cesiumViewerManager._baseLayers
    }

    // 每次都需要重新绑定事件（因为事件处理器绑定到当前Renderer实例）
    this._setupClickHandler()

    // 关键修复：无论Viewer是首次创建还是复用，都必须调用_setupZoomLimits()
    // 确保相机控制器的交互能力（拖拽、旋转、缩放等）被正确启用
    // 如果只在首次创建时调用，复用时可能因为之前的状态导致交互失效
    this._setupZoomLimits()

    // P1性能优化：相机变化防抖（300ms）
    // 避免相机移动时频繁触发渲染和状态更新
    this._setupCameraDebounce()
  }

  /**
   * P1性能优化：相机变化防抖
   *
   * 监听相机移动事件，300ms防抖后才触发渲染和状态同步。
   * 避免拖拽/缩放过程中频繁更新，降低CPU/GPU负载。
   */
  _setupCameraDebounce() {
    const DEBOUNCE_DELAY = 300
    // FIX:P1-12: 保存监听器引用，供 destroy 移除，防止泄漏与 TypeError
    this._cameraChangedHandler = () => {
      // 清除之前的防抖定时器
      if (this._cameraDebounceTimer) {
        clearTimeout(this._cameraDebounceTimer)
      }
      // 设置新的防抖定时器
      this._cameraDebounceTimer = setTimeout(() => {
        // FIX:P1-12: viewer 可能已置空，防御
        if (this.viewer) {
          this.viewer.scene.requestRender()
        }
        this._cameraDebounceTimer = null
      }, DEBOUNCE_DELAY)
    }
    this.viewer.camera.changed.addEventListener(this._cameraChangedHandler)
  }

  _setupZoomLimits() {
    const controller = this.viewer.scene.screenSpaceCameraController
    controller.minimumZoomDistance = 100
    controller.maximumZoomDistance = 500000
    // 显式启用相机控制器的所有交互能力
    // 确保拖拽、旋转、缩放、倾斜等交互可用
    controller.enableRotate = true
    controller.enableTranslate = true
    controller.enableZoom = true
    controller.enableTilt = true
    controller.enableLook = true
  }

  _positionCamera() {
    this.viewer.scene.globe.enableLighting = true
    // 不主动定位相机，保持 Cesium 默认的远距离视角（美国上空）
    // 后续 _setCameraState 的 flyTo 会从该位置飞向目标，产生"地球飞转"效果
    // 这是主动设计的加载动画，避免 OL→Cesium 切换时闪一下的突兀感
  }

  _initBaseLayers() {
    // 防止重复初始化底图
    if (cesiumViewerManager.isBaseLayersInitialized()) {
      return
    }

    const imageBaseLayer = this.viewer.imageryLayers.addImageryProvider(
      new UrlTemplateImageryProvider({
        url: buildTiandituUrl(MAP_CONFIG.BASE_LAYERS.image.layers[0]),
        maximumLevel: 18,
      }),
    )
    const imageAnnotationLayer = this.viewer.imageryLayers.addImageryProvider(
      new UrlTemplateImageryProvider({
        url: buildTiandituUrl(MAP_CONFIG.BASE_LAYERS.image.layers[1]),
        maximumLevel: 18,
      }),
    )
    const vectorBaseProvider = this.viewer.imageryLayers.addImageryProvider(
      new UrlTemplateImageryProvider({
        url: buildTiandituUrl(MAP_CONFIG.BASE_LAYERS.vector.layers[0]),
        maximumLevel: 18,
      }),
    )
    const vectorAnnotationProvider = this.viewer.imageryLayers.addImageryProvider(
      new UrlTemplateImageryProvider({
        url: buildTiandituUrl(MAP_CONFIG.BASE_LAYERS.vector.layers[1]),
        maximumLevel: 18,
      }),
    )
    vectorBaseProvider.show = false
    vectorAnnotationProvider.show = false

    this.baseLayers.image = [imageBaseLayer, imageAnnotationLayer]
    this.baseLayers.vector = [vectorBaseProvider, vectorAnnotationProvider]

    // 关键修复：将底图引用存储到单例管理器，供复用时新Renderer实例获取
    cesiumViewerManager._baseLayers = {
      image: this.baseLayers.image,
      vector: this.baseLayers.vector,
    }

    cesiumViewerManager.markBaseLayersInitialized()
  }

  _setupClickHandler() {
    this.viewer.screenSpaceEventHandler.setInputAction((click) => {
      const pickedObject = this.viewer.scene.pick(click.position)
      const cartesian = this.viewer.camera.pickEllipsoid(click.position)
      const coordinate = cartesian ? this._cartesianToLonLatArray(cartesian) : null

      if (pickedObject && pickedObject.id && pickedObject.id.properties) {
        const properties = pickedObject.id.properties.getValue?.() || pickedObject.id.properties
        const featureType = properties.featureType
        if (featureType) {
          this.emit(''click'', {
            featureType,
            data: properties,
            coordinate,
          })
          return
        }
      }
      this.emit(''click'', {
        featureType: null,
        data: null,
        coordinate,
      })
    }, ScreenSpaceEventType.LEFT_CLICK)
  }

  _cartesianToLonLatArray(cartesian) {
    const cartographic = Cartographic.fromCartesian(cartesian)
    return [
      CesiumMath.toDegrees(cartographic.longitude),
      CesiumMath.toDegrees(cartographic.latitude),
    ]
  }

  addPointLayer(id, features, options = {}) {
    // P0性能优化：Entity数量控制，超过1000个时警告
    const totalEntities = this.viewer.entities.values.length + features.length
    if (totalEntities > 1000 && import.meta.env.DEV) {
      console.warn(`[CesiumRenderer] Entity数量(${totalEntities})超过1000，可能影响帧率`)
    }

    const entities = []

    features.forEach((item) => {
      const entity = this.viewer.entities.add({
        id: `${id}-${item.id || item.name}`,
        position: Cartesian3.fromDegrees(item.lon, item.lat),
        point: {
          pixelSize: options.size || 12,
          color: Color.fromCssColorString(options.color || ''#409eff''),
          outlineColor: Color.WHITE,
          outlineWidth: 2,
        },
        label: options.labelField
          ? {
              text: item[options.labelField],
              font: ''12px sans-serif'',
              fillColor: Color.BLACK,
              showBackground: true,
              backgroundColor: Color.WHITE.withAlpha(0.8),
              verticalOrigin: 1,
              pixelOffset: new Cartesian2(0, 15),
            }
          : undefined,
        properties: { ...item, featureType: options.featureType || ''point'' },
      })
      entities.push(entity)
    })

    this._layers.set(id, {
      instance: entities,
      visible: true,
      options,
    })
    this._applyPendingVisibility(id)
    // 触发渲染
    this.viewer.scene.requestRender()
  }

  addPolygonLayer(id, features, options = {}) {
    const entities = []

    features.forEach((item) => {
      const coordinates = item.coordinates || item.geometry?.coordinates
      if (!coordinates) return

      if (!Array.isArray(coordinates) || coordinates.length === 0) return

      const geometryType = item.geometry?.type
      const createPolygon = (polyCoords) => {
        try {
          if (!Array.isArray(polyCoords) || !Array.isArray(polyCoords[0])) return
          const outerRing = polyCoords[0].map(([lng, lat]) => Cartesian3.fromDegrees(lng, lat))
          const holes = polyCoords.slice(1).map((holeCoords) => {
            const holePoints = holeCoords.map(([lng, lat]) => Cartesian3.fromDegrees(lng, lat))
            return new PolygonHierarchy(holePoints)
          })
          const entity = this.viewer.entities.add({
            polygon: {
              hierarchy: new PolygonHierarchy(outerRing, holes),
              material: Color.fromCssColorString(options.fillColor || ''rgba(77,171,247,0.15)''),
              outline: true,
              outlineColor: Color.fromCssColorString(options.strokeColor || ''#4dabf7''),
              outlineWidth: options.strokeWidth || 2,
            },
            properties: { ...item, featureType: options.featureType || ''polygon'' },
          })
          entities.push(entity)
        } catch (e) {
          if (import.meta.env.DEV) {
            console.warn(''创建多边形实体失败:'', e)
          }
        }
      }
      if (geometryType === ''MultiPolygon'') {
        coordinates.forEach((polyCoords) => createPolygon(polyCoords))
      } else {
        const coords = geometryType === ''Polygon'' ? coordinates : coordinates[0]
        createPolygon(coords)
      }
    })
    this._layers.set(id, {
      instance: entities,
      visible: true,
      options,
    })
    this._applyPendingVisibility(id)
    this.viewer.scene.requestRender()
  }

  async addGeoJsonLayer(id, geojson, options = {}) {
    // 幂等：先清除同 id 旧图层，防止 dataSource 累积
    const existing = this._layers.get(id)
    if (existing) this._doRemoveLayer(existing)

    try {
      const dataSource = await GeoJsonDataSource.load(geojson)

      logger.debug(`[CesiumRenderer] GeoJSON ${id} entities:`, dataSource.entities.values.length)
      dataSource.entities.values.forEach((entity) => {
        entity.properties.featureType = options.featureType || ''geojson''
        if (entity.polygon) {
          entity.polygon.height = 0.5
          entity.polygon.material = Color.fromCssColorString(
            options.fillColor || ''rgba(77,171,247,0.15)'',
          )
          entity.polygon.outline = true
          entity.polygon.outlineColor = Color.fromCssColorString(options.strokeColor || ''#4dabf7'')
          entity.polygon.outlineWidth = options.strokeWidth || 2
        } else if (entity.position) {
          // FIX:P1-11: 点要素用 PointGraphics 替代默认图钉，支持 markerColor/markerSize
          const markerColor = Color.fromCssColorString(options.markerColor || ''#409eff'')
          entity.billboard = undefined
          entity.point = new PointGraphics({
            pixelSize: options.markerSize || 10,
            color: markerColor,
            outlineColor: Color.WHITE,
            outlineWidth: 2,
          })
        }
      })
      this.viewer.dataSources.add(dataSource)

      this._layers.set(id, {
        instance: dataSource,
        visible: true,
        options,
      })
      this._applyPendingVisibility(id)
      this.viewer.scene.requestRender()
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error(`GeoJSON图层 ${id} 加载失败`, error)
      }
      options.onError?.(''GeoJSON数据加载失败'')
    }
  }

  _doSetVisibility(id, visible) {
    const layer = this._layers.get(id)
    if (layer && layer.instance) {
      if (Array.isArray(layer.instance)) {
        layer.instance.forEach((entity) => {
          if (entity) entity.show = visible
        })
      } else {
        layer.instance.show = visible
      }
      this.viewer.scene.requestRender()
    }
  }

  _doRemoveLayer(layer) {
    if (layer.instance) {
      if (Array.isArray(layer.instance)) {
        layer.instance.forEach((entity) => {
          if (entity) this.viewer.entities.remove(entity)
        })
      } else {
        this.viewer.dataSources.remove(layer.instance)
      }
      this.viewer.scene.requestRender()
    }
  }

  _doFlyTo(target, options = {}) {
    if (target.layerId) {
      const layer = this._layers.get(target.layerId)
      if (layer && layer.instance) {
        if (Array.isArray(layer.instance) && layer.instance.length > 0) {
          const entity = layer.instance[0]
          this.viewer.flyTo(entity)
          return
        } else if (layer.instance.entities) {
          this.viewer.flyTo(layer.instance)
          return
        }
      }
    }
    const height = options?.height ?? 5000
    // FIX:P3-01: 兼容数据源 lon 字段（ports.json）和接口 lng 字段
    const lng = target.lng ?? target.lon
    const lat = target.lat
    const destination = Cartesian3.fromDegrees(lng, lat, height)
    this.viewer.camera.flyTo({
      destination,
      // FIX:P1-10: Cesium duration 单位为秒（原 1000 秒 ≈ 16.6 分钟）
      duration: 1,
      orientation: {
        heading: CesiumMath.toRadians(options.heading || 0),
        // 默认俯视 -90°（与 OL 2D 平坦视图一致），避免引擎切换时 pickEllipsoid 因倾斜产生偏移
        pitch: CesiumMath.toRadians(options.pitch ?? -90),
        roll: 0,
      },
    })
  }

  _getCameraState() {
    const camera = this.viewer.camera

    const posCartographic = camera.positionCartographic

    // 导出 pitch（恢复时用）
    const pitchDeg = CesiumMath.toDegrees(camera.pitch)

    // 两种方式获取中心点：
    // 1. positionCartographic: 相机正下方地面点（不受 tilt 影响）
    // 2. pickEllipsoid: 屏幕中心射线地面点（用户实际注视点，受 tilt 影响）
    // 优先用 pickEllipsoid（OL 无 tilt 概念，取其"用户想看的点"），
    // 失败时回退到 positionCartographic
    const screenCenter = new Cartesian2(
      this.viewer.container.clientWidth / 2,
      this.viewer.container.clientHeight / 2,
    )
    const cartesian = camera.pickEllipsoid(screenCenter)
    let center
    if (cartesian) {
      const cartographic = Cartographic.fromCartesian(cartesian)
      center = {
        lng: CesiumMath.toDegrees(cartographic.longitude),
        lat: CesiumMath.toDegrees(cartographic.latitude),
      }
    } else {
      center = {
        lng: CesiumMath.toDegrees(posCartographic.longitude),
        lat: CesiumMath.toDegrees(posCartographic.latitude),
      }
    }

    const state = {
      center,
      height: posCartographic.height,
      pitch: pitchDeg,
    }

    logger.debug(''[CesiumRenderer._getCameraState] 导出状态:'', {
      center: state.center,
      height: state.height,
      heightKm: (state.height / 1000).toFixed(2) + ''km'',
      pitch: pitchDeg.toFixed(2) + ''°'',
      usingPick: cartesian !== null,
    })

    return state
  }

  _setCameraState(state) {
    logger.debug(''[CesiumRenderer._setCameraState] 导入原始状态:'', state)

    // 计算高度：优先使用 height，其次从 OL 的 zoom 转换
    let height = state.height
    if (height == null && state.zoom != null) {
      height = zoomToHeight(state.zoom)
    }
    if (height == null) {
      height = MAP_CONFIG.CAMERA.center.height
    }
    // 限制height范围：最低200m（避免贴地），最高1000000m（避免视角太高）
    height = Math.max(200, Math.min(height, 1000000))

    // pitch 强制 -90° 俯视，不与 OL 之间传递倾斜状态（OL 无 pitch 概念）
    const pitch = -90

    logger.debug(''[CesiumRenderer._setCameraState] 最终设置:'', {
      center: state.center,
      height: height,
      heightKm: (height / 1000).toFixed(2) + ''km'',
      pitch: pitch + ''°'',
    })

    const destination = Cartesian3.fromDegrees(state.center.lng, state.center.lat, height)

    // 从 Cesium 默认远距离视角（美国上空）飞向北部湾，产生"地球飞转"效果
    // duration 3s 保证足够时间完成跨半球飞行，又不至于太慢
    this.viewer.camera.flyTo({
      destination,
      duration: 3.0,
      orientation: {
        heading: 0,
        pitch: CesiumMath.toRadians(pitch),
        roll: 0,
      },
    })
  }

  setBaseLayer(type) {
    this.baseLayers.image.forEach((l) => {
      if (l) l.show = type === ''image''
    })
    this.baseLayers.vector.forEach((l) => {
      if (l) l.show = type === ''vector''
    })
    this.viewer.scene.requestRender()
  }

  startBreathing(lng, lat) {
    this.stopBreathing()
    const startTime = Date.now()
    const center = Cartesian3.fromDegrees(lng, lat)
    this._breathingEntity = this.viewer.entities.add({
      position: center,
      point: {
        pixelSize: new CallbackProperty(() => {
          const elapsed = (Date.now() - startTime) / 1000
          return 10 + Math.sin(elapsed * Math.PI * 2) * 5
        }, false),
        color: new CallbackProperty(() => {
          const elapsed = (Date.now() - startTime) / 1000
          const alpha = 0.5 + Math.sin(elapsed * Math.PI * 2) * 0.3
          return Color.fromCssColorString(`rgba(64,158,255,${alpha})`)
        }, false),
        outlineColor: Color.WHITE,
        outlineWidth: 2,
      },
    })
    this._breathingAnimation = () => {
      if (this._breathingEntity) {
        this.viewer.scene.requestRender()
        this._breathingAnimId = requestAnimationFrame(this._breathingAnimation)
      }
    }
    this._breathingAnimId = requestAnimationFrame(this._breathingAnimation)
  }

  stopBreathing() {
    if (this._breathingAnimId) {
      cancelAnimationFrame(this._breathingAnimId)
      this._breathingAnimId = null
    }
    if (this._breathingEntity) {
      this.viewer.entities.remove(this._breathingEntity)
      this._breathingEntity = null
    }
    this._breathingAnimation = null
  }

  // 使用Primitive API而非Entity，适合大规模几何体
  addWaterSurface(id, coordinates, height = 0, options = {}) {
    this.removeWaterSurface(id)
    const positions = coordinates.map((coord) => Cartesian3.fromDegrees(coord[0], coord[1], height))
    const hierarchy = new PolygonHierarchy(positions)
    const geometry = new PolygonGeometry({
      polygonHierarchy: hierarchy,
      vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
    })

    // 创建几何实例（包含颜色信息）
    const instance = new GeometryInstance({
      geometry: geometry,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(
          Color.fromCssColorString(options.color || ''rgba(64, 158, 255, 0.5)''),
        ),
      },
      id: `water-${id}`,
    })

    // 创建外观（支持透明度）
    const appearance = new PerInstanceColorAppearance({
      translucent: true,
      closed: false,
    })

    // 创建Primitive并添加到场景
    const primitive = new Primitive({
      geometryInstances: instance,
      appearance: appearance,
      asynchronous: false,
    })

    this.viewer.scene.primitives.add(primitive)

    // 保存水面状态供后续更新使用
    this._waterSurfaces = this._waterSurfaces || new Map()
    this._waterSurfaces.set(id, {
      primitive: primitive,
      height: height,
      coordinates: coordinates,
      options: options,
      visible: true,
    })

    this.viewer.scene.requestRender()
  }

  /**
   * 更新水位高度
   *
   * 通过重建Primitive实现水位更新。
   * 保留原始坐标和样式选项，仅改变高度。
   *
   * @param {string} id - 水面图层ID
   * @param {number} newHeight - 新的高度（米）
   */
  updateWaterLevel(id, newHeight) {
    const waterSurface = this._waterSurfaces?.get(id)
    if (!waterSurface) {
      if (import.meta.env.DEV) {
        console.warn(`水面图层 ${id} 不存在，无法更新水位`)
      }
      return
    }

    // 用新高度重建水面
    this.addWaterSurface(id, waterSurface.coordinates, newHeight, waterSurface.options)
  }

  /**
   * 移除水面Primitive
   * @param {string} id - 水面图层ID
   */
  removeWaterSurface(id) {
    const waterSurface = this._waterSurfaces?.get(id)
    if (waterSurface) {
      this.viewer.scene.primitives.remove(waterSurface.primitive)
      this._waterSurfaces.delete(id)
      this.viewer.scene.requestRender()
    }
  }

  /**
   * 移除所有水面
   */
  removeAllWaterSurfaces() {
    if (this._waterSurfaces) {
      this._waterSurfaces.forEach((_, id) => this.removeWaterSurface(id))
    }
  }

  /**
   * 设置水面可见性
   * @param {string} id - 水面图层ID
   * @param {boolean} visible - 是否可见
   */
  setWaterSurfaceVisibility(id, visible) {
    const waterSurface = this._waterSurfaces?.get(id)
    if (waterSurface) {
      waterSurface.visible = visible
      waterSurface.primitive.show = visible
      this.viewer.scene.requestRender()
    }
  }

  getType() {
    return ''cesium''
  }

  getViewer() {
    return this.viewer
  }

  updateSize() {
    this.viewer?.resize()
    this.viewer?.scene.requestRender()
  }

  /**
   * 销毁渲染器（不销毁Viewer单例）
   * 仅从DOM卸载，保留Viewer实例供下次复用
   */
  destroy() {
    // FIX:P1-12: 移除相机监听器
    if (this.viewer && this._cameraChangedHandler) {
      this.viewer.camera.changed.removeEventListener(this._cameraChangedHandler)
      this._cameraChangedHandler = null
    }
    super.destroy()
    this.stopBreathing()
    // 清理相机防抖定时器，防止内存泄漏
    if (this._cameraDebounceTimer) {
      clearTimeout(this._cameraDebounceTimer)
      this._cameraDebounceTimer = null
    }
    // 清除空闲销毁定时器（如果存在）
    cesiumViewerManager._clearIdleDestroyTimer()
    // 不销毁Viewer，只从DOM卸载
    cesiumViewerManager.unmount()
    this.viewer = null
  }
}
```

## src/core/map/renderers/MapRenderer.js

```javascript
export class MapRenderer {
  constructor(container) {
    if (new.target === MapRenderer) {
      throw new Error('MapRenderer是抽象类，不能直接实例化'')
    }
    this.container = container
    this._layers = new Map()
    this._eventBus = new EventTarget()
    this._pendingVisibility = new Map()
  }

  async init() {
    throw new Error(`${this.getType()} init 未实现`)
  }

  addPointLayer(_id, _features, _options = {}) {
    throw new Error(`${this.getType()} addPointLayer 未实现`)
  }

  addPolygonLayer(_id, _features, _options = {}) {
    throw new Error(`${this.getType()} addPolygonLayer 未实现`)
  }

  addGeoJsonLayer(_id, _geojson, _options = {}) {
    throw new Error(`${this.getType()} addGeoJsonLayer 未实现`)
  }

  // TODO:0.1: 新增热力图图层抽象方法
  // FIX:偏3: 原设计文档使用 addGeoJsonLayer({type:''heatmap''})，但现有接口不支持
  // 正确做法：独立方法，子类按需实现
  addHeatmapLayer(_id, _features, _options = {}) {
    if (import.meta.env.DEV) {
      console.warn(`${this.getType()} addHeatmapLayer 未实现（仅 2D 渲染器支持）`)
    }
    return false
  }

  updateHeatmapLayer(_id, _features, _options = {}) {
    if (import.meta.env.DEV) {
      console.warn(`${this.getType()} updateHeatmapLayer 未实现`)
    }
    return false
  }

  setVisibility(id, visible) {
    const layer = this._layers.get(id)
    if (layer) {
      layer.visible = visible
      this._doSetVisibility(id, visible)
    } else {
      this._pendingVisibility.set(id, visible)
    }
  }

  _applyPendingVisibility(id) {
    if (this._pendingVisibility.has(id)) {
      this.setVisibility(id, this._pendingVisibility.get(id))
      this._pendingVisibility.delete(id)
    }
  }

  removeLayer(id) {
    const layer = this._layers.get(id)
    if (!layer) return

    this._doRemoveLayer(layer)
    this._layers.delete(id)
  }

  flyTo(target, options = {}) {
    const normalizedTarget = this._normalizeFlyToTarget(target)
    if (!normalizedTarget) {
      throw new Error(`${this.getType()} flyTo 目标格式不支持`)
    }
    this._doFlyTo(normalizedTarget, options)
  }

  _normalizeFlyToTarget(target) {
    if (Array.isArray(target) && target.length === 2) {
      return { lng: target[0], lat: target[1] }
    }
    if (typeof target === ''object'' && target.lng !== undefined && target.lat !== undefined) {
      return { lng: target.lng, lat: target.lat }
    }
    if (typeof target === ''string'') {
      return { layerId: target }
    }
    if (typeof target === ''object'' && target.layerId) {
      return target
    }
    return null
  }

  on(event, handler) {
    this._eventBus.addEventListener(event, handler)
  }

  off(event, handler) {
    this._eventBus.removeEventListener(event, handler)
  }

  emit(event, data) {
    this._eventBus.dispatchEvent(new CustomEvent(event, { detail: data }))
  }

  exportState() {
    const state = {}
    for (const [id, layer] of this._layers) {
      state[id] = { visible: layer.visible }
    }
    const camera = this._getCameraState()
    if (camera) {
      state._camera = camera
    }
    return state
  }

  importState(state) {
    const camera = state._camera
    delete state._camera

    for (const [id, cfg] of Object.entries(state)) {
      this.setVisibility(id, cfg.visible)
    }

    if (camera) {
      this._setCameraState(camera)
    }
  }

  getType() {
    return ''base''
  }

  destroy() {
    this._layers.forEach((layer) => this._doRemoveLayer(layer))
    this._layers.clear()
    this._pendingVisibility.clear()
    this._eventBus = new EventTarget()
  }

  _doSetVisibility(_id, _visible) {
    throw new Error(''_doSetVisibility 未实现'')
  }

  _doRemoveLayer(_layer) {
    throw new Error(''_doRemoveLayer 未实现'')
  }

  _doFlyTo(_target, _options) {
    throw new Error(''_doFlyTo 未实现'')
  }

  _getCameraState() {
    return null
  }

  _setCameraState(_state) {}

  addWaterSurface(_id, _coordinates, _height = 0, _options = {}) {
    if (import.meta.env.DEV) {
      console.warn(`${this.getType()} addWaterSurface 未实现（仅 3D 渲染器支持）`)
    }
    return false
  }

  updateWaterLevel(_id, _newHeight) {
    if (import.meta.env.DEV) {
      console.warn(`${this.getType()} updateWaterLevel 未实现（仅 3D 渲染器支持）`)
    }
    return false
  }

  removeWaterSurface(_id) {
    if (import.meta.env.DEV) {
      console.warn(`${this.getType()} removeWaterSurface 未实现（仅 3D 渲染器支持）`)
    }
    return false
  }

  removeAllWaterSurfaces() {
    if (import.meta.env.DEV) {
      console.warn(`${this.getType()} removeAllWaterSurfaces 未实现（仅 3D 渲染器支持）`)
    }
    return false
  }

  setWaterSurfaceVisibility(_id, _visible) {
    if (import.meta.env.DEV) {
      console.warn(`${this.getType()} setWaterSurfaceVisibility 未实现（仅 3D 渲染器支持）`)
    }
    return false
  }

  startBreathing(_lng, _lat) {
    if (import.meta.env.DEV) {
      console.warn(`${this.getType()} startBreathing 未实现（仅 3D 渲染器支持）`)
    }
    return false
  }

  stopBreathing() {
    if (import.meta.env.DEV) {
      console.warn(`${this.getType()} stopBreathing 未实现（仅 3D 渲染器支持）`)
    }
    return false
  }
}
```

## src/core/map/renderers/OLRenderer.js

```javascript
import { MapRenderer } from './MapRenderer''
import Map from ''ol/Map''
import View from ''ol/View''
import { fromLonLat, toLonLat } from ''ol/proj''
import VectorSource from ''ol/source/Vector''
import VectorLayer from ''ol/layer/Vector''
import TileLayer from ''ol/layer/Tile''
import XYZ from ''ol/source/XYZ''
import Point from ''ol/geom/Point''
import Polygon from ''ol/geom/Polygon''
import Feature from ''ol/Feature''
import GeoJSON from ''ol/format/GeoJSON''
import { Style, Fill, Stroke, Circle, Text } from ''ol/style''
import Heatmap from ''ol/layer/Heatmap''
import { buildTiandituUrl, MAP_CONFIG, heightToZoom } from ''@/core/config/map''
import { logger } from ''@/shared/utils/logger''

export class OLRenderer extends MapRenderer {
  constructor(container) {
    super(container)
    this.map = null
    this.baseLayers = { image: [], vector: [] }
    this._initMap()
  }
  _initMap() {
    const view = new View({
      center: fromLonLat([MAP_CONFIG.CAMERA.center.lng, MAP_CONFIG.CAMERA.center.lat]),
      zoom: 9,
      minZoom: 6,
      maxZoom: 20,
    })
    this.map = new Map({
      target: this.container,
      view,
      layers: [],
    })
    this._initBaseLayers()
    this._setupClickHandler()
  }
  _initBaseLayers() {
    const imageLayers = MAP_CONFIG.BASE_LAYERS.image.layers.map((code) => {
      const layer = new TileLayer({
        source: new XYZ({
          url: buildTiandituUrl(code),
          crossOrigin: ''anonymous'',
        }),
      })
      layer.set(''isBaseMap'', true)
      layer.set(''baseType'', ''image'')
      return layer
    })
    const vectorLayers = MAP_CONFIG.BASE_LAYERS.vector.layers.map((code) => {
      const layer = new TileLayer({
        source: new XYZ({
          url: buildTiandituUrl(code),
          crossOrigin: ''anonymous'',
        }),
      })
      layer.set(''isBaseMap'', true)
      layer.set(''baseType'', ''vector'')
      layer.setVisible(false)
      return layer
    })
    this.baseLayers.image = imageLayers
    this.baseLayers.vector = vectorLayers

    imageLayers.forEach((l) => this.map.addLayer(l))
    vectorLayers.forEach((l) => this.map.addLayer(l))
  }
  _setupClickHandler() {
    this.map.on(''click'', (event) => {
      const coordinate = toLonLat(event.coordinate)
      let clickedFeature = false

      this.map.forEachFeatureAtPixel(
        event.pixel,
        (feature) => {
          const featureType = feature.get(''featureType'')
          if (featureType) {
            const properties = feature.getProperties()
            this.emit(''click'', {
              featureType,
              data: properties,
              coordinate,
            })
            clickedFeature = true
            return true
          }
        },
        {
          layerFilter: (layer) => !layer.get(''isBaseMap''),
        },
      )
      if (!clickedFeature) {
        this.emit(''click'', {
          featureType: null,
          data: null,
          coordinate,
        })
      }
    })
  }

  addPointLayer(id, features, options = {}) {
    const olFeatures = features.map((item) => {
      const feature = new Feature({
        geometry: new Point(fromLonLat([item.lon, item.lat])),
      })
      const featureType = options?.featureType || item?.featureType || ''point''
      feature.setProperties({ ...item, featureType })
      return feature
    })
    const style = this._createPointStyle(options)

    const vectorLayer = new VectorLayer({
      source: new VectorSource({ features: olFeatures }),
      style,
    })
    this.map.addLayer(vectorLayer)
    this._layers.set(id, {
      instance: vectorLayer,
      visible: true,
      options,
    })
    this._applyPendingVisibility(id)
  }
  _createPointStyle(options) {
    if (!options.labelField) {
      return new Style({
        image: new Circle({
          radius: options.size || 12,
          fill: new Fill({ color: options.color || ''#409eff'' }),
          stroke: new Stroke({ color: ''#fff'', width: 2 }),
        }),
      })
    }
    return (feature) =>
      new Style({
        image: new Circle({
          radius: options.size || 12,
          fill: new Fill({ color: options.color || ''#409eff'' }),
          stroke: new Stroke({ color: ''#fff'', width: 2 }),
        }),
        text: new Text({
          text: feature.get(options.labelField),
          font: ''12px sans-serif'',
          fill: new Fill({ color: ''#000'' }),
          stroke: new Stroke({ color: ''#fff'', width: 2 }),
          offsetY: 15,
        }),
      })
  }
  addPolygonLayer(id, features, options = {}) {
    // FIX:GIS-008: 辅助函数 - 确保坐标环闭合
    const ensureRingClosed = (ring) => {
      if (!ring || ring.length < 3) return null
      const first = ring[0]
      const last = ring[ring.length - 1]
      // 如果首尾坐标不相同，添加闭合点
      if (first[0] !== last[0] || first[1] !== last[1]) {
        return [...ring, first]
      }
      return ring
    }

    const olFeatures = features
      .map((item) => {
        const coordinates = item.coordinates || item.geometry?.coordinates
        if (!coordinates) return null

        // FIX:010: 验证坐标数组有效性
        if (!Array.isArray(coordinates) || coordinates.length === 0) return null

        let polygonCoords
        if (item.geometry?.type === ''MultiPolygon'') {
          // FIX:010: 验证MultiPolygon坐标结构
          if (!Array.isArray(coordinates[0]) || !Array.isArray(coordinates[0][0])) return null
          // FIX:GIS-008: 验证并闭合每个多边形的坐标环
          polygonCoords = coordinates
            .map((poly) => {
              const closedRing = ensureRingClosed(poly[0])
              return closedRing ? closedRing.map(([lng, lat]) => fromLonLat([lng, lat])) : null
            })
            .filter((coords) => coords !== null)
          if (polygonCoords.length === 0) return null
        } else {
          // FIX:010: 验证Polygon坐标结构
          if (!Array.isArray(coordinates[0]) || !Array.isArray(coordinates[0][0])) return null
          // FIX:GIS-008: 验证并闭合坐标环
          const closedRing = ensureRingClosed(coordinates[0])
          if (!closedRing) return null
          polygonCoords = [closedRing.map(([lng, lat]) => fromLonLat([lng, lat]))]
        }
        const feature = new Feature({
          geometry: new Polygon(polygonCoords),
        })
        feature.setProperties({ ...item, featureType: options.featureType || ''polygon'' })
        return feature
      })
      .filter(Boolean)

    const style = this._createPolygonStyle(options)

    const vectorLayer = new VectorLayer({
      source: new VectorSource({ features: olFeatures }),
      style,
    })
    this.map.addLayer(vectorLayer)
    this._layers.set(id, {
      instance: vectorLayer,
      visible: true,
      options,
    })
    this._applyPendingVisibility(id)
  }
  _createPolygonStyle(options) {
    return new Style({
      fill: new Fill({ color: options.fillColor || ''rgba(77,171,247,0.15)'' }),
      stroke: new Stroke({
        color: options.strokeColor || ''#4dabf7'',
        width: options.strokeWidth || 2,
      }),
    })
  }
  addGeoJsonLayer(id, geojson, options = {}) {
    const features = new GeoJSON().readFeatures(geojson, {
      featureProjection: ''EPSG:3857'',
    })
    features.forEach((feature) => {
      feature.set(''featureType'', options.featureType || ''geojson'')
    })
    // FIX:P1-11: 按几何类型分派样式，点要素支持 markerColor/markerSize
    const polygonStyle = this._createPolygonStyle(options)
    const pointStyle = new Style({
      image: new Circle({
        radius: (options.markerSize || 10) / 2,
        fill: new Fill({ color: options.markerColor || ''#409eff'' }),
        stroke: new Stroke({ color: ''#fff'', width: 2 }),
      }),
    })
    // TODO:4.0: 支持 options.style 回调，用于 per-feature 样式（预测分析等业务需要）
    const defaultStyle = (feature) => {
      const geom = feature.getGeometry()
      return geom.getType() === ''Point'' ? pointStyle : polygonStyle
    }
    const vectorLayer = new VectorLayer({
      source: new VectorSource({ features }),
      style: options.style || defaultStyle,
    })
    this.map.addLayer(vectorLayer)
    this._layers.set(id, {
      instance: vectorLayer,
      visible: true,
      options,
    })
    this._applyPendingVisibility(id)
  }

  // TODO:0.1: 新增热力图图层方法
  // FIX:偏3: 原设计文档使用 addGeoJsonLayer({type:''heatmap''})，但现有接口不支持
  // 正确做法：独立方法 + 参考 OpenLayers Heatmap 官方示例
  addHeatmapLayer(id, features, options = {}) {
    const {
      weightField = ''value'',
      radius = 20,
      blur = 15,
      gradient = [''#00f'', ''#0ff'', ''#0f0'', ''#ff0'', ''#f00''],
      opacity = 0.6,
    } = options

    // 将 features 数组转为 OpenLayers Feature
    const olFeatures = features.map((f) => {
      const [lng, lat] = f.geometry.coordinates
      const feature = new Feature({
        geometry: new Point(fromLonLat([lng, lat])),
      })
      // 将 properties 展开为 feature 属性（weightField 对应的值用于热力权重）
      Object.entries(f.properties || {}).forEach(([key, value]) => {
        feature.set(key, value)
      })
      return feature
    })

    const source = new VectorSource({ features: olFeatures })

    const layer = new Heatmap({
      source,
      radius: Number(radius),
      blur: Number(blur),
      weight: (feature) => {
        const val = feature.get(weightField)
        return val !== undefined && val !== null ? Number(val) : 0
      },
      gradient,
      opacity,
    })

    layer.set(''id'', id)
    this.map.addLayer(layer)
    this._layers.set(id, {
      instance: layer,
      visible: true,
      options,
    })
    this._applyPendingVisibility(id)

    return layer
  }

  updateHeatmapLayer(id, features, options = {}) {
    const entry = this._layers.get(id)
    if (!entry) return false

    const source = entry.instance.getSource()
    if (!source) return false

    const { weightField: _weightField = ''value'' } = options

    const olFeatures = features.map((f) => {
      const [lng, lat] = f.geometry.coordinates
      const feature = new Feature({
        geometry: new Point(fromLonLat([lng, lat])),
      })
      Object.entries(f.properties || {}).forEach(([key, value]) => {
        feature.set(key, value)
      })
      return feature
    })

    source.clear()
    source.addFeatures(olFeatures)
    // 更新层内缓存的 options 以便后续使用
    if (options) entry.options = options
    return true
  }

  _doSetVisibility(id, visible) {
    const layer = this._layers.get(id)
    if (layer && layer.instance) {
      layer.instance.setVisible(visible)
    }
  }
  _doRemoveLayer(layer) {
    if (layer.instance) {
      this.map.removeLayer(layer.instance)
      if (layer.instance.getSource) {
        const source = layer.instance.getSource()
        if (source && source.clear) {
          source.clear()
        }
        // FIX:GIS-010: 调用 dispose() 释放资源
        if (source && source.dispose) {
          source.dispose()
        }
      }
    }
  }
  _doFlyTo(target, options = {}) {
    const view = this.map.getView()
    if (target.layerId) {
      const layer = this._layers.get(target.layerId)
      if (layer && layer.instance) {
        // FIX:016: 验证 source 和 getExtent 方法存在性
        const source = layer.instance.getSource()
        if (source && typeof source.getExtent === ''function'') {
          const extent = source.getExtent()
          if (extent) {
            view.fit(extent, { duration: 1000 })
            return
          }
        }
      }
    }
    // FIX:P3-01: 兼容数据源 lon 字段（ports.json）和接口 lng 字段
    const lng = target.lng ?? target.lon
    view.animate({
      center: fromLonLat([lng, target.lat]),
      zoom: options.zoom || view.getZoom(),
      duration: 1000,
    })
  }
  _getCameraState() {
    const view = this.map.getView()
    const center = toLonLat(view.getCenter())
    const zoom = view.getZoom()

    const state = {
      center: { lng: center[0], lat: center[1] },
      zoom,
    }

    logger.debug(''[OLRenderer._getCameraState] 导出状态:'', state)

    return state
  }
  _setCameraState(state) {
    logger.debug(''[OLRenderer._setCameraState] 导入原始状态:'', state)

    const view = this.map.getView()
    let zoom

    // 从 Cesium 的 height 反算 OL zoom
    if (state.height != null) {
      zoom = heightToZoom(state.height)
    } else if (state.zoom != null) {
      zoom = state.zoom
    }

    // 钳制在合法范围内
    const clampedZoom = zoom != null ? Math.min(Math.max(zoom, 6), 20) : view.getZoom()

    // 原子设置 center+zoom，避免分离调用触发的动画冲突导致 view 状态错乱
    view.animate({
      center: fromLonLat([state.center.lng, state.center.lat]),
      zoom: clampedZoom,
      duration: 0,
    })
  }
  setBaseLayer(type) {
    this.baseLayers.image.forEach((l) => l.setVisible(type === ''image''))
    this.baseLayers.vector.forEach((l) => l.setVisible(type === ''vector''))
  }
  startBreathing(lng, lat) {
    this.stopBreathing()
    const startTime = Date.now()
    const breathingFeature = new Feature({
      geometry: new Point(fromLonLat([lng, lat])),
    })
    const breathingStyle = () => {
      const elapsed = (Date.now() - startTime) / 1000
      const radius = 10 + Math.sin(elapsed * Math.PI * 2) * 5
      const alpha = 0.5 + Math.sin(elapsed * Math.PI * 2) * 0.3
      return new Style({
        image: new Circle({
          radius,
          fill: new Fill({ color: `rgba(64,158,255,${alpha})` }),
          stroke: new Stroke({ color: ''#fff'', width: 2 }),
        }),
      })
    }
    this._breathingLayer = new VectorLayer({
      source: new VectorSource({ features: [breathingFeature] }),
      style: breathingStyle,
    })
    this.map.addLayer(this._breathingLayer)
    const animate = () => {
      if (this._breathingLayer) {
        this._breathingLayer.changed()
        this._breathingAnimId = requestAnimationFrame(animate)
      }
    }
    this._breathingAnimId = requestAnimationFrame(animate)
  }
  stopBreathing() {
    if (this._breathingAnimId) {
      cancelAnimationFrame(this._breathingAnimId)
      this._breathingAnimId = null
    }
    if (this._breathingLayer) {
      this.map.removeLayer(this._breathingLayer)
      this._breathingLayer.dispose()
      this._breathingLayer = null
    }
  }
  getType() {
    return ''ol''
  }
  getMap() {
    return this.map
  }
  updateSize() {
    this.map?.updateSize()
  }
  addWaterSurface(_id, _coordinates, _height, _options) {
    if (import.meta.env.DEV) {
      console.warn(''[OLRenderer] addWaterSurface 不支持 2D 渲染器'')
    }
    return false
  }

  updateWaterLevel(_id, _newHeight) {
    if (import.meta.env.DEV) {
      console.warn(''[OLRenderer] updateWaterLevel 不支持 2D 渲染器'')
    }
    return false
  }

  removeWaterSurface(_id) {
    if (import.meta.env.DEV) {
      console.warn(''[OLRenderer] removeWaterSurface 不支持 2D 渲染器'')
    }
    return false
  }

  removeAllWaterSurfaces() {
    if (import.meta.env.DEV) {
      console.warn(''[OLRenderer] removeAllWaterSurfaces 不支持 2D 渲染器'')
    }
    return false
  }

  setWaterSurfaceVisibility(_id, _visible) {
    if (import.meta.env.DEV) {
      console.warn(''[OLRenderer] setWaterSurfaceVisibility 不支持 2D 渲染器'')
    }
    return false
  }

  destroy() {
    super.destroy()
    this.stopBreathing()
    this.map?.dispose()
    this.map = null
  }
}
```

## src/core/map/renderers/index.js

```javascript
import { MapRenderer } from './MapRenderer''
import { OLRenderer } from ''./OLRenderer''

export { MapRenderer, OLRenderer }

/**
 * 创建地图渲染器
 *
 * - 2D（OL）：静态导入，首屏即可用
 * - 3D（Cesium）：动态导入，仅进入 3D 路由时才加载，避免首屏加载 5MB+ 的 Cesium
 */
export async function createRenderer(type, container) {
  if (type === ''2d'') {
    return new OLRenderer(container)
  }
  // 按需加载 Cesium 渲染器（仅在切换到 3D 时触发）
  const { CesiumRenderer } = await import(''./CesiumRenderer'')
  return new CesiumRenderer(container)
}
```

## 核心地图组件

## src/core/map/BusinessLayerManager.js

```javascript
import { LAYER_ADAPTERS } from './layerAdapters.js''

export class BusinessLayerManager {
  /**
   * @param {object} mapStore - Pinia mapStore 实例
   */
  constructor(mapStore) {
    this._mapStore = mapStore
    this._registry = new Map()
  }

  /**
   * 获取当前活跃的 renderer（动态，不缓存）
   */
  _getRenderer() {
    return this._mapStore.currentRenderer
  }

  /**
   * 获取 layerType 对应的 adapter
   */
  _getAdapter(layerType) {
    const adapter = LAYER_ADAPTERS[layerType]
    if (!adapter) {
      console.warn(`[BusinessLayerManager] 未知 layerType: ${layerType}`)
      return null
    }
    return adapter
  }

  /**
   * 注册新业务图层
   *
   * @param {string} key
   * @param {object} descriptor
   * @param {string} descriptor.label       - LayerControlPanel 显示名
   * @param {string} descriptor.layerType   - ''heatmap'' | ''geojson'' | ''points'' | ''polygon'' | ''waterSurface''
   * @param {*}      descriptor.data        - 业务数据（格式取决于 layerType）
   * @param {object} descriptor.options     - 样式参数
   * @param {boolean} descriptor.visible    - 初始可见性，默认 true
   */
  register(key, { label, layerType, data, options = {}, visible = true }) {
    if (this._registry.has(key)) {
      console.warn(`[BusinessLayerManager] 图层 ${key} 已注册，请使用 updateData 更新数据`)
      return
    }

    const adapter = this._getAdapter(layerType)
    if (!adapter) return

    // 保存元数据
    this._registry.set(key, { layerType, options })

    // 注册到 layerCatalog（只存元数据，不存 renderer 对象）
    this._mapStore.registerBusinessLayer(key, label, layerType, visible)

    // 如果可见且有数据，立即渲染
    if (visible && data != null) {
      const renderer = this._getRenderer()
      if (renderer) {
        adapter.create(renderer, key, data, options)
      }
    }
  }

  /**
   * 更新图层数据
   *
   * 不改变 visible 状态。如果当前可见则立即重建图层；不可见则只缓存数据。
   *
   * @param {string} key
   * @param {object} payload
   * @param {*}      payload.data
   * @param {object} payload.options
   */
  updateData(key, { data, options }) {
    const meta = this._registry.get(key)
    if (!meta) {
      throw new Error(`[BusinessLayerManager] 图层 "${key}" 未注册，请先调用 register(''${key}'', ...)`)
    }

    const adapter = this._getAdapter(meta.layerType)
    if (!adapter) return

    // 合并 options
    if (options) {
      meta.options = { ...meta.options, ...options }
    }

    // 查找 catalog 条目确认可见性
    const catalogEntry = this._mapStore.layerCatalog.find((e) => e.key === key)
    if (!catalogEntry || !catalogEntry.visible) {
      return
    }

    // 可见 → 更新图层
    const renderer = this._getRenderer()
    if (renderer) {
      adapter.update(renderer, key, data, meta.options)
    }
  }

  /**
   * 设置显隐
   *
   * LayerControlPanel 通过此方法控制图层显隐，
   * 不直接操作 renderer。
   *
   * @param {string} key
   * @param {boolean} visible
   */
  setVisible(key, visible) {
    const catalogEntry = this._mapStore.layerCatalog.find((e) => e.key === key)
    if (!catalogEntry) {
      console.warn(`[BusinessLayerManager] 图层 ${key} 不在 catalog 中`)
      return
    }

    catalogEntry.visible = visible
    const renderer = this._getRenderer()
    if (!renderer) return

    // 用 renderer.setVisibility 来显隐，不销毁图层
    // 图层数据仍保留在 renderer 内部，toggle 回来时直接可见
    renderer.setVisibility(key, visible)
  }

  /**
   * 移除业务图层
   *
   * 从 renderer 和 layerCatalog 同时移除。
   */
  remove(key) {
    const meta = this._registry.get(key)
    if (meta) {
      const adapter = this._getAdapter(meta.layerType)
      if (adapter) {
        const renderer = this._getRenderer()
        if (renderer) {
          adapter.remove(renderer, key)
        }
      }
      this._registry.delete(key)
    }

    this._mapStore.removeLayer(key)
  }

  /**
   * 批量移除所有已注册的业务图层
   */
  removeAll() {
    for (const key of this._registry.keys()) {
      this.remove(key)
    }
  }

  /**
   * 检查图层是否已注册
   */
  has(key) {
    return this._registry.has(key)
  }

  /**
   * 获取图层元数据
   */
  getMeta(key) {
    return this._registry.get(key) || null
  }
}
```

## src/core/map/UnifiedMap.vue

```vue
<script setup>
// 统一地图容器：OL/Cesium双引擎，v-show切换，渲染器实例复用不销毁
import { ref, watch, onMounted, onUnmounted, provide, nextTick, computed } from 'vue''
import { createRenderer } from ''@/core/map/renderers''
import { MapRendererKey } from ''@/core/map/composables/useMapRenderer''
import { useMapStore } from ''@/stores/map''
import { loadPorts, buildPortGeoJson, PORT_STYLE } from ''@/core/map/composables/usePortLayer''
import { loadBoundaryGeoJson, BOUNDARY_STYLE } from ''@/core/map/composables/useBoundaryLayer''
import { useLayerManager } from ''@/core/map/composables/useLayerManager''
import { CELL_PIXEL } from ''@/core/layout/config.js''
import { useGCS } from ''@/core/layout/useGCS.js''
import { logger } from ''@/shared/utils/logger''

const { cell8px } = useGCS()

const props = defineProps({
  mapType: {
    type: String,
    default: ''2d'',
    validator: (v) => [''2d'', ''3d''].includes(v),
  },
})

const emit = defineEmits([''typeChange'', ''click'', ''error''])

// 两个容器引用（OL始终存在，Cesium首次创建后保留）
const olContainerRef = ref(null)
const cesiumContainerRef = ref(null)

const loading = ref(true)
const switching = ref(false)
const loadError = ref('''')
const boundaryWarning = ref('''')
const currentRenderer = ref(null)
const mapStore = useMapStore()
const olRenderer = ref(null)
const cesiumRenderer = ref(null)
const cesiumInitialized = ref(false)

provide(MapRendererKey, currentRenderer)
provide(''mapStore'', mapStore)

const { registerBaseLayerWithRenderer, registerToggleable, clearLayers } = useLayerManager()

const spinnerSizeCss = computed(() => `${Math.round(CELL_PIXEL * 0.5)}px`)

let portGeoJson = null
let boundaryGeoJson = null

function withTimeout(promise, timeoutMs, errorMessage) {
  let timeoutId
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId))
}

// v-show切换后浏览器未必完成layout，用rAF等待容器有实际尺寸再初始化渲染器
function waitForContainerVisible(container) {
  return new Promise((resolve) => {
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
          console.warn(''waitForContainerVisible: 容器尺寸检查超时，继续执行'')
        }
        resolve()
      }
    }
    requestAnimationFrame(check)
  })
}

async function loadData() {
  try {
    const ports = await withTimeout(loadPorts(), 10000, ''港口数据加载超时'')
    portGeoJson = buildPortGeoJson(ports)
    boundaryGeoJson = await withTimeout(
      loadBoundaryGeoJson((msg) => {
        boundaryWarning.value = msg
      }),
      10000,
      ''边界数据加载超时'',
    )
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error(''地图数据加载失败:'', error)
    }
    if (error.message.includes(''超时'')) {
      loadError.value = error.message
    }
  }
}

/**
 * 初始化指定类型的渲染器（首次创建或复用）
 * @param {''2d''|''3d''} type - 渲染器类型
 * @param {HTMLElement} container - DOM容器
 */
async function initRenderer(type, container) {
  if (!container) {
    if (import.meta.env.DEV) {
      console.error(`initRenderer: ${type}容器为空`)
    }
    return
  }

  await waitForContainerVisible(container)

  try {
    const existingRenderer = type === ''2d'' ? olRenderer.value : cesiumRenderer.value

    if (existingRenderer) {
      // 复用已有渲染器
      currentRenderer.value = existingRenderer
      mapStore.setCurrentRenderer(existingRenderer)

      if (type === ''3d'') {
        const { cesiumViewerManager } = await import(''@/core/map/renderers/CesiumRenderer'')
        cesiumViewerManager.mount(container)
      }

      currentRenderer.value.updateSize()
      // 图层目录的show/hide绑定的是渲染器实例，切换回来需重新注册
      setupLayers()
    } else {
      const renderer = await createRenderer(type, container)

      if (type === ''2d'') {
        olRenderer.value = renderer
      } else {
        cesiumRenderer.value = renderer
      }

      currentRenderer.value = renderer
      mapStore.setCurrentRenderer(renderer)
      currentRenderer.value.updateSize()
      setupLayers()
      setupEvents()
    }

    mapStore.setMap(
      type === ''2d'' ? currentRenderer.value.getMap() : currentRenderer.value.getViewer(),
    )
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error(`Renderer ${type} 初始化失败:`, error)
    }
    loadError.value = error.message || ''地图初始化失败''
    emit(''error'', error)
  }
}

// 每次切换引擎时重新注册图层目录（show/hide绑定当前渲染器实例）
// _layers Map检查防止重复添加图层
function setupLayers() {
  clearLayers()

  registerBaseLayerWithRenderer(''base-image'', ''影像底图'', currentRenderer.value)
  registerBaseLayerWithRenderer(''base-vector'', ''矢量底图'', currentRenderer.value)

  if (boundaryGeoJson && !currentRenderer.value._layers.has(''boundary'')) {
    currentRenderer.value.addGeoJsonLayer(''boundary'', boundaryGeoJson, BOUNDARY_STYLE)
  }
  if (boundaryGeoJson) {
    registerToggleable(''boundary'', ''行政区划'', currentRenderer.value)
  }

  if (portGeoJson && !currentRenderer.value._layers.has(''ports'')) {
    const validFeatures = portGeoJson.features.filter((f) => {
      if (!f?.geometry?.coordinates) return false
      if (!Array.isArray(f.geometry.coordinates) || f.geometry.coordinates.length < 2) return false
      const [lng, lat] = f.geometry.coordinates
      return !(lng === 0 && lat === 0)
    })
    if (validFeatures.length > 0) {
      currentRenderer.value.addPointLayer(
        ''ports'',
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
    registerToggleable(''ports'', ''港口位置'', currentRenderer.value)
  }

}

function setupEvents() {
  currentRenderer.value.on(''click'', (event) => {
    const { featureType, data, coordinate } = event.detail
    if (featureType === ''port'' && data) {
      mapStore.setSelectedPort(data)
    } else {
      mapStore.clearSelectedPort()
    }
    emit(''click'', { featureType, data, coordinate })
  })
}

function getContainer(type) {
  return type === ''2d'' ? olContainerRef.value : cesiumContainerRef.value
}

// 双引擎切换：v-show控制显示，渲染器实例保留复用，失败时回滚mapType
async function switchMapType(newType) {
  if (switching.value) return

  // 用渲染器实际类型而非mapStore.mapType，后者可能已被route.meta.engine提前更新
  const oldType = currentRenderer.value?.getType() || mapStore.mapType
  switching.value = true
  loading.value = true

  logger.debug(`[UnifiedMap] switchMapType: ${oldType} → ${newType}`)
  logger.debug(
    `[UnifiedMap] mapStore.mapType=${mapStore.mapType}, currentRenderer.type=${currentRenderer.value?.getType()}`,
  )

  // 如果 oldType 和 newType 相同，无需切换
  if (oldType === newType) {
    logger.debug(''[UnifiedMap] 类型相同，跳过切换'')
    switching.value = false
    loading.value = false
    return
  }

  try {
    let cameraState = null
    if (currentRenderer.value) {
      cameraState = currentRenderer.value.exportState()
    }

    if (mapStore.mapType !== newType) {
      mapStore.setMapType(newType)
    }

    if (newType === ''3d'' && !cesiumInitialized.value) {
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

    emit(''typeChange'', newType)
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error(`切换到 ${newType} 失败:`, error)
    }
    loadError.value = error.message || ''地图切换失败''

    // 初始化失败时回滚 mapStore.mapType，避免容器因 v-show 被隐藏
    if (oldType !== newType) {
      mapStore.setMapType(oldType)
    }

    emit(''error'', error)
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
    <div v-show="mapType === ''2d''" ref="olContainerRef" class="map-container"></div>

    <div
      v-if="cesiumInitialized"
      v-show="mapType === ''3d''"
      ref="cesiumContainerRef"
      class="map-container"
    ></div>

    <Transition name="fade">
      <div v-if="loading || switching" class="map-loading">
        <div class="loading-spinner"></div>
        <span>{{ switching ? ''切换视图中...'' : ''地图加载中...'' }}</span>
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
```

## src/core/map/composables/useBoundaryLayer.js

```javascript
export async function loadBoundaryGeoJson(onError) {
  const CACHE_KEY = 'beibu-gulf-boundary-cache''
  const CACHE_EXPIRY = 24 * 60 * 60 * 1000 // 24小时缓存有效期
  const MAX_RETRIES = 3
  const TIMEOUT_MS = 10000

  // FIX:P01: 检查缓存
  try {
    const cached = sessionStorage.getItem(CACHE_KEY)
    if (cached) {
      const { data, timestamp } = JSON.parse(cached)
      if (Date.now() - timestamp < CACHE_EXPIRY) {
        return data
      }
    }
  } catch {
    // 缓存读取失败，继续加载
  }

  // FIX:P01: 带重试和超时的加载
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

      const response = await fetch(''/beibu-gulf-merged-data.geojson'', {
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(''边界数据加载失败'')
      }

      const geojson = await response.json()
      
      // 防御性检查：确保 features 数组存在
      if (!Array.isArray(geojson.features)) {
        throw new Error(''GeoJSON 格式无效：缺少 features 数组'')
      }

      // FIX:015: 验证feature.properties存在性
      geojson.features.forEach((f) => {
        if (!f.properties) {
          f.properties = {}
        }
        f.properties.featureType = ''boundary''
      })

      // FIX:P01: 缓存数据
      try {
        sessionStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ data: geojson, timestamp: Date.now() })
        )
      } catch {
        // 缓存写入失败不影响功能
      }

      return geojson
    } catch (error) {
      const isTimeout = error.name === ''AbortError''
      const isLastAttempt = attempt === MAX_RETRIES

      if (import.meta.env.DEV) {
        console.warn(
          `[useBoundaryLayer] 加载失败 (第${attempt}次):`,
          isTimeout ? ''超时'' : error.message
        )
      }

      if (isLastAttempt) {
        // FIX:017 (错误): 仅在开发环境输出错误
        if (import.meta.env.DEV) {
          console.error(''边界数据加载失败:'', error)
        }
        onError?.(''边界数据加载失败，图层可能缺失'')
        return null
      }

      // 等待后重试（线性退避：1s, 2s, 3s）
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
    }
  }

  return null
}

export const BOUNDARY_STYLE = {
  strokeColor: ''#4dabf7'',
  strokeWidth: 2,
  fillColor: ''rgba(77,171,247,0.15)'',
  featureType: ''boundary'',
}
```

## src/core/map/composables/useBusinessLayers.js

```javascript
import { inject } from 'vue''

export const BUSINESS_LAYER_MANAGER_KEY = Symbol(''businessLayerManager'')

export function useBusinessLayers() {
  const manager = inject(BUSINESS_LAYER_MANAGER_KEY)

  if (!manager) {
    console.warn(''[useBusinessLayers] BusinessLayerManager 未注入，请确认 UnifiedMap 已 provide'')
    return {
      manager: {
        register: () => {},
        updateData: () => {},
        setVisible: () => {},
        remove: () => {},
        has: () => false,
        removeAll: () => {},
        getMeta: () => null,
      },
    }
  }

  return { manager }
}
```

## src/core/map/composables/useLayerManager.js

```javascript
import { computed, inject } from 'vue''

// 图层管理 composable：通过 inject(''mapStore'') 解耦
export function useLayerManager() {
  const store = inject(''mapStore'')
  
  if (!store) {
    console.warn(''[useLayerManager] mapStore 未注入，请在父组件中提供'')
    return {
      clearLayers: () => {},
      registerBaseLayer: () => {},
      registerBaseLayerWithRenderer: () => {},
      registerToggleable: () => {},
      toggleLayer: () => {},
      layerCatalog: computed(() => []),
    }
  }
  
  const layerCatalog = computed(() => store.layerCatalog)

  function clearLayers() {
    store.clearLayerCatalog()
  }

  function registerBaseLayer(key, label, show, hide) {
    store.registerBaseLayer(key, label, show, hide)
  }

  function registerToggleable(key, label, rendererOrShow, hide, visible = undefined) {
    if (typeof rendererOrShow === ''object'' && rendererOrShow.setVisibility) {
      store.registerToggleable(key, label, () => rendererOrShow.setVisibility(key, true), () => rendererOrShow.setVisibility(key, false), visible)
    } else {
      store.registerToggleable(key, label, rendererOrShow, hide, visible)
    }
  }

  function registerBaseLayerWithRenderer(key, label, renderer) {
    const showFn = () => renderer.setBaseLayer(key === ''base-image'' ? ''image'' : ''vector'')
    const hideFn = () => {}

    store.registerBaseLayer(key, label, showFn, hideFn)
  }

  function toggleLayer(key) {
    store.toggleLayer(key)
  }

  return {
    clearLayers,
    registerBaseLayer,
    registerBaseLayerWithRenderer,
    registerToggleable,
    toggleLayer,
    layerCatalog,
  }
}
```

## src/core/map/composables/useMapControls.js

```javascript
import { inject, computed } from 'vue''
import { MAP_CONFIG } from ''@/core/config/map''

export function useMapControls() {
  const unifiedMapRef = inject(''unifiedMap'', null)
  const mapInstance = computed(() => unifiedMapRef?.value)

  function flyTo(target, options = {}) {
    mapInstance.value?.flyTo(target, options)
  }

  function startBreathing(lng, lat) {
    mapInstance.value?.startBreathing(lng, lat)
  }

  function stopBreathing() {
    mapInstance.value?.stopBreathing()
  }

  function zoomToRegion() {
    const regionLevel = MAP_CONFIG.VIEW_LEVELS.REGION
    flyTo(regionLevel.center, { height: regionLevel.height })
  }

  function zoomToCity() {
    const cityLevel = MAP_CONFIG.VIEW_LEVELS.CITY
    flyTo(cityLevel.center, { height: cityLevel.height })
  }

  function zoomToDistrict() {
    const districtLevel = MAP_CONFIG.VIEW_LEVELS.DISTRICT
    flyTo(districtLevel.center, { height: districtLevel.height })
  }

  return {
    flyTo,
    startBreathing,
    stopBreathing,
    zoomToRegion,
    zoomToCity,
    zoomToDistrict,
    mapInstance,
  }
}
```

## src/core/map/composables/useMapRenderer.js

```javascript
import { inject, unref } from 'vue''

export const MapRendererKey = Symbol(''mapRenderer'')

export function useMapRenderer() {
  const rendererRef = inject(MapRendererKey)
  if (!rendererRef) {
    throw new Error(''useMapRenderer 必须在 UnifiedMap 组件内部使用'')
  }
  return unref(rendererRef)
}
```

## src/core/map/composables/usePortLayer.js

```javascript
import { mapDataService } from '@/services/mapDataService''

export async function loadPorts() {
  return await mapDataService.getPorts()
}

export function buildPortGeoJson(portsData) {
  return {
    type: ''FeatureCollection'',
    features: portsData
      .filter((port) => {
        // FIX:016: 验证port.lon和port.lat字段存在性
        if (port.lon === undefined || port.lat === undefined) {
          if (import.meta.env.DEV) {
            console.warn(''港口数据缺少坐标字段:'', port)
          }
          return false
        }
        // FIX:016: 验证坐标有效性
        if (typeof port.lon !== ''number'' || typeof port.lat !== ''number'') {
          if (import.meta.env.DEV) {
            console.warn(''港口坐标字段类型无效:'', port)
          }
          return false
        }
        return true
      })
      .map((port) => ({
        type: ''Feature'',
        geometry: {
          type: ''Point'',
          coordinates: [port.lon, port.lat],
        },
        properties: {
          ...port,
          featureType: ''port'',
        },
      })),
  }
}

export const PORT_STYLE = {
  size: 12,
  color: ''#409eff'',
  labelField: ''name'',
  featureType: ''port'',
}
```

## src/core/map/layerAdapters.js

```javascript
export const LAYER_ADAPTERS = {
  heatmap: {
    create: (renderer, key, data, options) => {
      renderer.addHeatmapLayer(key, data, options)
    },
    update: (renderer, key, data, options) => {
      renderer.updateHeatmapLayer(key, data, options)
    },
    remove: (renderer, key) => {
      renderer.removeLayer(key)
    },
  },

  geojson: {
    create: (renderer, key, data, options) => {
      renderer.addGeoJsonLayer(key, data, options)
    },
    update: (renderer, key, data, options) => {
      renderer.removeLayer(key)
      renderer.addGeoJsonLayer(key, data, options)
    },
    remove: (renderer, key) => {
      renderer.removeLayer(key)
    },
  },

  points: {
    create: (renderer, key, data, options) => {
      renderer.addPointLayer(key, data, options)
    },
    update: (renderer, key, data, options) => {
      renderer.removeLayer(key)
      renderer.addPointLayer(key, data, options)
    },
    remove: (renderer, key) => {
      renderer.removeLayer(key)
    },
  },

  polygon: {
    create: (renderer, key, data, options) => {
      renderer.addPolygonLayer(key, data, options)
    },
    update: (renderer, key, data, options) => {
      renderer.removeLayer(key)
      renderer.addPolygonLayer(key, data, options)
    },
    remove: (renderer, key) => {
      renderer.removeLayer(key)
    },
  },

  waterSurface: {
    create: (renderer, key, data, options) => {
      renderer.addWaterSurface(key, data.coordinates, data.height, options)
    },
    update: (renderer, key, data, _options) => {
      renderer.updateWaterLevel(key, data.height)
    },
    remove: (renderer, key) => {
      renderer.removeWaterSurface(key)
    },
  },

  // 预留: entity, primitive, 3dtiles, volume, terrain ...
}
```

## 布局系统

## src/core/layout/AppLayout.vue

```vue
<script setup>
/**
 * AppLayout - GCS V2 布局基座（Layout Base）
 *
 * 职责：
 * 1. 通过 PPS 定位所有 Panel（无容器、无 Zone、无 TopArea）
 * 2. 提供 slot 供业务路由注入自定义 Panel 内容
 * 3. 管理检查模式状态
 *
 * V2 阶段 3 变更：
 * - 移除 TopArea 组件引用（改为独立 Panel 集合）
 * - 折线图/柱状图/雷达图/图层控制直接放入 GcsPanel slot
 * - 标题 + 城市按钮 + 个人中心按钮渲染为独立 Panel
 *
 * 使用方式：
 * <AppLayout>
 *   <template #left>自定义左侧内容</template>
 *   <template #right>自定义右侧内容</template>
 * </AppLayout>
 */

import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { useGCS } from './useGCS.js'
import BottomNavBar from ''./components/BottomNavBar.vue''
import GcsInspectionOverlay from ''./components/GcsInspectionOverlay.vue''
import GcsPanel from ''./components/GcsPanel.vue''
import NavButton from ''./components/NavButton.vue''
import PanelTitle from ''@/shared/components/PanelTitle.vue''
import LineChart from ''@/visualization/charts/LineChart.vue''
import BarChart from ''@/visualization/charts/BarChart.vue''
import RadarChart from ''@/visualization/charts/RadarChart.vue''
import LayerControlPanel from ''@/shared/components/LayerControlPanel.vue''
import { useScreenActions } from ''@/shared/composables/useScreenActions.js''

const route = useRoute()
const { showPanels, showTopArea, css } = useGCS()
// 解构出 CSS 变量供 v-bind() 使用
const { cell8px } = css
const { flyToCity, goProfileOrBack, userButtonLabel } = useScreenActions()

// 检查模式状态
const inspectionMode = ref(false)
const isDev = import.meta.env.DEV

/**
 * 折线图数据（默认数据，与旧版 Zone2 一致）
 */
const chartData = {
  labels: [''2019'', ''2020'', ''2021'', ''2022'', ''2023'', ''2024''],
  series: [
    { name: ''钦州港'', data: [120, 132, 101, 134, 190, 230] },
    { name: ''北海港'', data: [90, 110, 120, 115, 140, 180] },
    { name: ''防城港'', data: [80, 95, 110, 125, 150, 170] },
  ],
}

/**
 * 柱状图数据（默认数据，与旧版 Zone5 一致）
 */
const barData = {
  labels: [''钦州港'', ''北海港'', ''防城港''],
  series: [
    { name: ''2023年'', data: [190, 140, 150] },
    { name: ''2024年'', data: [230, 180, 170] },
  ],
}
</script>

<template>
  <div class="app-layout">
    <!-- Title Panel（4×1，左上，第一行） -->
    <GcsPanel
      v-show="showTopArea"
      :w="4"
      :h="1"
      anchor="top-left"
      :offset-x="0"
      :offset-y="0"
      class="title-panel"
    >
      <PanelTitle :title="route.meta?.title || ''北部湾智慧港口平台''" />
    </GcsPanel>

    <!-- 顶部按钮组 Panel（4×1，右上，第一行，与 Title 同行） -->
    <GcsPanel
      v-show="showTopArea"
      :w="4"
      :h="1"
      anchor="top-right"
      :offset-x="0"
      :offset-y="0"
      class="top-button-panel"
    >
      <div class="top-button-inner">
        <NavButton label="钦州" @click="flyToCity(''钦州'')" />
        <NavButton label="北海" @click="flyToCity(''北海'')" />
        <NavButton label="防城港" @click="flyToCity(''防城港'')" />
        <NavButton :label="userButtonLabel" icon="👤" @click="goProfileOrBack" />
      </div>
    </GcsPanel>

    <!-- 左侧 Panel 组 -->
    <slot name="left">
      <!-- 左上：折线图 4×4 -->
      <GcsPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
        <LineChart title="港口吞吐量趋势" :x-data="chartData.labels" :series="chartData.series" />
      </GcsPanel>
      <!-- 左下：柱状图 4×4 -->
      <GcsPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="5.5">
        <BarChart title="港口吞吐量对比" :x-data="barData.labels" :series="barData.series" />
      </GcsPanel>
    </slot>

    <!-- 右侧 Panel 组 -->
    <div v-show="showPanels">
      <slot name="right">
        <!-- 右上：雷达图 4×4 -->
        <GcsPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <RadarChart
            :visible="true"
            :xiaoqu="null"
            :selected-types="[]"
            :embedded="false"
            :facility-poi="{}"
          />
        </GcsPanel>
        <!-- 右下：图层控制 4×4（接入真实功能） -->
        <GcsPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
          <LayerControlPanel />
        </GcsPanel>
      </slot>
    </div>

    <!-- 底部导航 -->
    <BottomNavBar v-model:inspectionMode="inspectionMode" />

    <!-- 检查模式（仅开发环境） -->
    <GcsInspectionOverlay v-if="isDev && inspectionMode" :enabled="inspectionMode" />
  </div>
</template>

<style scoped>
.app-layout {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 50;
}

/* 所有 Panel 子元素恢复 pointer-events */
.app-layout > * {
  pointer-events: auto;
}

/* Title Panel 容器样式 */
.title-panel {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 顶部按钮组 Panel 内部样式 */
.top-button-panel {
  display: flex;
  align-items: center;
  justify-content: center;
}

.top-button-inner {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-around;
  box-sizing: border-box;
}

/* 图层控制面板内部样式：2 列网格，10 个按钮 */
.layer-panel-inner {
  width: 100%;
  height: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  align-content: flex-start;
  justify-content: center;
  gap: 10px; /* 10px 非8的整数倍，保留 */
  padding: 10px; /* 10px 非8的整数倍，保留 */
  box-sizing: border-box;
}

.layer-title {
  flex: none;
  font-size: 16px;
  font-weight: 600;
  color: #333;
  padding: v-bind(cell8px) 0;
}

.layer-divider {
  flex: none;
  height: 1px;
  background-color: #f0f0f0;
  margin: v-bind(cell8px) 0;
}

.layer-buttons {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 10px; /* 10px 非8的整数倍，保留 */
}
</style>
```

## src/core/layout/components/BottomNavBar.vue

```vue
<script>
export default { name: 'GcsBottomNavBar'' }
</script>

<script setup>
/**
 * BottomNavBar - 底部业务导航条
 *
 * 职责：
 * 1. 作为唯一业务导航入口，承载 6 个核心功能按钮 + 1 个检查模式按钮
 * 2. 居中悬浮于视口底部
 * 3. 当前路由对应按钮自动高亮
 *
 * 设计说明：
 * - 容器宽度根据 navItems.length + 1 自动计算（+1 为检查模式按钮）
 * - 内部 6 个 1×1 NavButton + 1 个检查按钮等分容器宽度
 * - 未实现业务使用 disabled 态占位，保持导航结构稳定
 *
 * V2 变更：
 * - 移除 SAFE_MARGIN 导入（不再需要手动计算 Dock 位置）
 * - 移除 onMounted/onUnmounted（不再需要手动管理视口尺寸）
 * - 移除 viewportWidth/viewportHeight/dockLeft/dockCellX/dockCellY
 * - GcsPanel 改用 anchor="bottom-center" 由 PPS 引擎自动定位
 */

import { computed } from ''vue''
import { useRoute, useRouter } from ''vue-router''
import GcsPanel from ''./GcsPanel.vue''
import NavButton from ''./NavButton.vue''
import { useGCS } from ''../useGCS.js''

const route = useRoute()
const router = useRouter()
const { cellPixel } = useGCS()

/**
 * 检查模式开关状态
 * - 用于开发验收，验证 GCS 是否正确落地
 * - 生产环境默认关闭
 */
const inspectionMode = defineModel(''inspectionMode'', { type: Boolean, default: false })

// 暴露给 CSS v-bind 使用的计算属性
const toggleSizeCss = computed(() => `${Math.round(cellPixel.value * 0.75)}px`)
const toggleFontSizeCss = computed(() => `${Math.round(cellPixel.value * 0.15)}px`)
const toggleIconSizeCss = computed(() => `${Math.round(cellPixel.value * 0.175)}px`)
const toggleMarginTopCss = computed(() => `${Math.round(cellPixel.value * 0.025)}px`)

/**
 * 底部导航按钮配置
 * - 已启用：首页、选址分析、个人中心
 * - 未启用：吞吐量、热力图、航线分析（disabled 占位）
 */
const navItems = computed(() => [
  { label: ''首页'', icon: ''⌂'', route: ''/'', disabled: false },
  { label: ''选址分析'', icon: ''◈'', route: ''/site-selection'', disabled: false },
  { label: ''预测分析'', icon: ''📊'', route: ''/forecast'', disabled: false },
  { label: ''浸没分析'', icon: ''🌊'', route: ''/heatmap'', disabled: false },
  { label: ''航线分析'', icon: ''🚢'', route: ''/route-analysis'', disabled: true },
  { label: ''个人中心'', icon: ''👤'', route: ''/profile'', disabled: false },
])

// Dock 宽度 = 导航按钮数 + 1（检查模式按钮），随 navItems 自动扩展
const dockCellCount = computed(() => navItems.value.length + 1)

// V2 变更：Dock 定位改用 PPS 的 bottom-center 锚点，不再需要手动管理视口尺寸

function isActive(item) {
  if (!item.route) return false
  return route.path === item.route
}

function handleClick(item) {
  if (item.disabled || !item.route) return
  router.push(item.route)
}
</script>

<template>
  <GcsPanel
    :w="dockCellCount"
    :h="1"
    anchor="bottom-center"
    :offset-x="0"
    :offset-y="0"
    class="bottom-nav-bar dock-panel"
  >
    <div class="nav-inner">
      <NavButton
        v-for="item in navItems"
        :key="item.label"
        :label="item.label"
        :icon="item.icon"
        :disabled="item.disabled"
        :active="isActive(item)"
        @click="handleClick(item)"
      />
      <!-- 检查模式开关按钮 -->
      <button
        type="button"
        class="inspection-toggle"
        :class="{ active: inspectionMode }"
        @click="inspectionMode = !inspectionMode"
      >
        <span class="button-label">检查</span>
        <span class="button-icon">🔍</span>
      </button>
    </div>
  </GcsPanel>
</template>

<style scoped>
.bottom-nav-bar {
  z-index: 60;
  pointer-events: auto;
}

.nav-inner {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-around;
  box-sizing: border-box;
}

.inspection-toggle {
  flex: 0 0 auto;
  width: v-bind(toggleSizeCss);
  height: v-bind(toggleSizeCss);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #fff;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: v-bind(toggleFontSizeCss);
  color: #333;
}

.inspection-toggle:hover {
  background: #f5f5f5;
  border-color: #4ecdc4;
}

.inspection-toggle.active {
  background: #4ecdc4;
  border-color: #4ecdc4;
  color: #fff;
}

.inspection-toggle .button-label {
  font-weight: 500;
  line-height: 1.2;
}

.inspection-toggle .button-icon {
  font-size: v-bind(toggleIconSizeCss);
  margin-top: v-bind(toggleMarginTopCss);
}
</style>
```

## src/core/layout/components/GcsButton.vue

```vue
<script setup>
/**
 * GcsButton - 按钮 Panel
 *
 * 统一视觉规则：
 * - 默认占 2×1 Cell
 * - 文字优先显示，图标位于文字下方（如果提供）
 * - 尺寸基于 CELL_PIXEL 计算
 * - 白色实体背景，带 hover 反馈
 *
 * Props:
 * - label: 按钮文字
 * - icon: 图标字符/类名（可选）
 * - disabled: 是否禁用
 * - active: 是否处于激活/选中态（用于图层开关等）
 * - w: 横向 Cell 数（默认 2）
 * - h: 纵向 Cell 数（默认 1）
 */

import { computed } from 'vue'
import { useGCS } from '../useGCS.js'

const props = defineProps({
  label: { type: String, default: '''' },
  icon: { type: String, default: '''' },
  disabled: { type: Boolean, default: false },
  active: { type: Boolean, default: false },
  w: { type: Number, default: 2 },
  h: { type: Number, default: 1 },
})

const emit = defineEmits([''click''])

const { cell, cellPixel } = useGCS()

const buttonStyle = computed(() => ({
  ...cell(props.w, props.h),
  borderRadius: `${cellPixel.value * 0.15}px`,
  backgroundColor: props.active ? ''#409eff'' : ''#ffffff'',
  color: props.active ? ''#ffffff'' : ''#333333'',
  boxShadow: ''0 2px 8px rgba(0, 0, 0, 0.1)'',
  fontSize: `${cellPixel.value * 0.18}px`,
}))

const iconStyle = computed(() => ({
  marginTop: `${cellPixel.value * 0.05}px`,
  fontSize: ''0.85em'',
  opacity: 0.9,
}))

function handleClick() {
  if (!props.disabled) {
    emit(''click'')
  }
}
</script>

<template>
  <button
    type="button"
    class="gcs-button"
    :style="buttonStyle"
    :disabled="disabled"
    @click="handleClick"
  >
    <span class="button-label">{{ label }}</span>
    <span v-if="icon" class="button-icon" :style="iconStyle" aria-hidden="true">{{ icon }}</span>
  </button>
</template>

<style scoped>
.gcs-button {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: none;
  outline: none;
  cursor: pointer;
  color: #fff;
  transition: background-color 0.2s ease, transform 0.1s ease;
}

.gcs-button:hover:not(:disabled) {
  background-color: rgba(255, 255, 255, 0.22);
}

.gcs-button:active:not(:disabled) {
  transform: scale(0.98);
}

.gcs-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.button-label {
  font-weight: 500;
  line-height: 1.2;
}

.button-icon {
  font-size: 0.85em;
  opacity: 0.9;
}
</style>
```

## src/core/layout/components/GcsInspectionOverlay.vue

```vue
<script setup>
/**
 * GcsInspectionOverlay - GCS 检查模式覆盖层
 *
 * 职责：
 * 1. 可视化 Cell 网格边界和编号
 * 2. 动态检测并显示 Panel / Dock / Container / TopArea 的实际边界
 * 3. 自动验证各元素是否与 Cell 网格对齐
 * 4. 显示当前 GCS 参数与对齐状态
 *
 * 设计说明：
 * - 仅用于开发验收，生产环境默认关闭
 * - 禁止拖拽、换位、动态编辑等交互功能
 * - 边界信息通过 DOM getBoundingClientRect 动态获取，确保反映真实渲染结果
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useGCS } from '../useGCS.js'
import { SAFE_MARGIN, PANEL_SPACING, GRID_SIZE, CELL_PIXEL } from ''../config.js''

const props = defineProps({
  enabled: { type: Boolean, default: false },
})

const { cellPixel, gap, padding } = useGCS()

// 用于 CSS v-bind 的计算属性：标签位置（基于 CELL_PIXEL 的比例）
const labelOffsetCss = computed(() => `${Math.round(CELL_PIXEL * 0.05)}px`)
const labelFontSizeSmallCss = computed(() => `${Math.round(CELL_PIXEL * 0.1375)}px`)
const labelFontSizeMediumCss = computed(() => `${Math.round(CELL_PIXEL * 0.15)}px`)
const labelPaddingCss = computed(
  () => `${Math.round(CELL_PIXEL * 0.025)}px ${Math.round(CELL_PIXEL * 0.075)}px`,
)

// 信息面板样式（基于 CELL_PIXEL 的比例）
const infoPanelOffsetCss = computed(() => `${Math.round(CELL_PIXEL * 0.25)}px`)
const infoPanelPaddingCss = computed(() => `${Math.round(CELL_PIXEL * 0.2)}px`)
const infoPanelFontSizeCss = computed(() => `${Math.round(CELL_PIXEL * 0.1625)}px`)
const infoPanelMinWidthCss = computed(() => `${Math.round(CELL_PIXEL * 2.5)}px`)
const infoTitleFontSizeCss = computed(() => `${Math.round(CELL_PIXEL * 0.175)}px`)
const infoTitleMarginCss = computed(() => `${Math.round(CELL_PIXEL * 0.15)}px`)
const infoTitlePaddingCss = computed(() => `${Math.round(CELL_PIXEL * 0.1)}px`)
const infoItemMarginCss = computed(() => `${Math.round(CELL_PIXEL * 0.1)}px`)

// 响应式视口尺寸
const viewportWidth = ref(typeof window !== ''undefined'' ? window.innerWidth : 1920)
const viewportHeight = ref(typeof window !== ''undefined'' ? window.innerHeight : 1080)

// 从 DOM 动态测量的元素边界
const measuredPanels = ref([])
const measuredDock = ref(null)

// 对齐验证结果
const alignmentIssues = ref([])

/**
 * 更新视口尺寸
 */
function updateViewport() {
  viewportWidth.value = window.innerWidth
  viewportHeight.value = window.innerHeight
}

/**
 * 获取单个元素相对于视口的边界信息
 * @param {string} selector - CSS 选择器
 * @param {string} label - 显示标签
 * @returns {{ id: string, label: string, x: number, y: number, width: number, height: number } | null}
 */
function measureElement(selector, label) {
  const el = document.querySelector(selector)
  if (!el) return null
  const rect = el.getBoundingClientRect()
  return {
    id: selector,
    label,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  }
}

/**
 * 获取多个同类元素的边界信息
 * @param {string} selector - CSS 选择器
 * @param {string} prefix - 标签前缀
 * @returns {Array<{ id: string, label: string, x: number, y: number, width: number, height: number }>}
 */
function measureElements(selector, prefix) {
  return Array.from(document.querySelectorAll(selector)).map((el, index) => {
    const rect = el.getBoundingClientRect()
    return {
      id: `${selector}-${index}`,
      label: `${prefix} ${index + 1}`,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    }
  })
}

/**
 * 测量所有需要检查边界的元素
 * V2 变更：移除 Container 和 TopArea 检测（V2 无 Container，TopArea 已拆分为独立 Panel）
 */
function measureAll() {
  if (typeof window === ''undefined'') return
  // Dock 使用独立的 GcsPanel，从 Panel 列表中排除，避免重复检测
  // 仅保留实际可见（尺寸大于 0）的 Panel
  measuredPanels.value = measureElements(''.gcs-panel:not(.dock-panel)'', ''Panel'').filter(
    (panel) => panel.width > 0 && panel.height > 0,
  )
  measuredDock.value = measureElement(''.bottom-nav-bar'', ''Dock'')
  validateAlignment()
}

/**
 * 判断数值是否符合 PPS 定位模式（允许 1px 浮点误差）
 * PPS 公式有三种模式：
 * - left 锚点:   value = SAFE_MARGIN + n × CELL_PIXEL
 * - right 锚点:  value = W - SAFE_MARGIN - n × CELL_PIXEL
 * - center 锚点: value = (W - n × CELL_PIXEL) / 2
 * @param {number} value
 * @returns {boolean}
 */
function isPpsAligned(value) {
  const C = cellPixel.value
  const S = SAFE_MARGIN
  const W = viewportWidth.value

  // 模式 1: SAFE_MARGIN + n × CELL_PIXEL (left 锚点)
  const remainder1 = (value - S) % C
  if (remainder1 <= 1 || remainder1 >= C - 1) return true

  // 模式 2: W - SAFE_MARGIN - n × CELL_PIXEL (right 锚点)
  const remainder2 = (W - S - value) % C
  if (remainder2 <= 1 || remainder2 >= C - 1) return true

  // 模式 3: (W - n × CELL_PIXEL) / 2 (center 锚点)
  const remainder3 = (W - value * 2) % C
  if (remainder3 <= 1 || remainder3 >= C - 1) return true

  return false
}

/**
 * 判断数值是否对齐到 Cell 网格（允许 1px 浮点误差）
 * 用于验证 Panel 尺寸（width/height）是否为 CELL_PIXEL 的整数倍
 * @param {number} value
 * @returns {boolean}
 */
function isCellAligned(value) {
  const remainder = value % cellPixel.value
  return remainder <= 1 || remainder >= cellPixel.value - 1
}

/**
 * 记录对齐问题
 * @param {string} name - 元素名称
 * @param {string} field - 不对齐的字段
 * @param {number} value - 实际值
 * @param {string} [expected] - 预期值描述（默认 Cell 倍数）
 */
function recordIssue(name, field, value, expected) {
  alignmentIssues.value.push({
    name,
    field,
    value: Math.round(value),
    expected: expected || `multiple of ${cellPixel.value}px`,
  })
}

/**
 * 验证单个矩形是否符合 PPS 定位 + Cell 尺寸
 * - 位置 (x, y)：必须符合 PPS 公式 SAFE_MARGIN + n × CELL_PIXEL
 * - 尺寸 (width, height)：必须是 CELL_PIXEL 的整数倍
 * @param {string} name
 * @param {{ x: number, y: number, width: number, height: number }} rect
 * @param {Object} options
 * @param {boolean} options.skipX
 * @param {boolean} options.skipY
 */
function validateRect(name, rect, options = {}) {
  if (!options.skipX && !isPpsAligned(rect.x)) {
    recordIssue(name, ''x'', rect.x, `PPS formula (left/right/center)`)
  }
  if (!options.skipY && !isPpsAligned(rect.y)) {
    recordIssue(name, ''y'', rect.y, `PPS formula (left/right/center)`)
  }
  if (!isCellAligned(rect.width)) recordIssue(name, ''width'', rect.width)
  if (!isCellAligned(rect.height)) recordIssue(name, ''height'', rect.height)
}

/**
 * 验证 Dock 是否水平居中
 * 由于 Dock 需要吸附到 Cell 网格，允许在吸附后与绝对中心存在最多半个 Cell 的偏移
 * @param {{ x: number, width: number }} dockRect
 */
function validateDockCenter(dockRect) {
  const expectedX = (viewportWidth.value - dockRect.width) / 2
  const diff = Math.abs(dockRect.x - expectedX)
  if (diff > cellPixel.value / 2 + 1) {
    alignmentIssues.value.push({
      name: ''Dock'',
      field: ''center'',
      value: Math.round(dockRect.x),
      expected: Math.round(expectedX),
    })
  }
}

/**
 * 验证 Panel 到 Canvas 边缘的间距 >= SAFE_MARGIN
 * PPS 公式保证 offset=0 的 Panel 边缘恰好在 SAFE_MARGIN 处，
 * offset>0 的 Panel 边缘更远，所以只需检查最小间距
 * @param {{ label: string, x: number, y: number, width: number, height: number }} panel
 */
function validateEdgeSpacing(panel) {
  const minSpacing = SAFE_MARGIN

  // 上边缘：必须 >= SAFE_MARGIN
  if (panel.y < minSpacing - 1) {
    recordIssue(panel.label, ''top-edge'', panel.y, `>= ${minSpacing}px`)
  }
  // 左边缘：必须 >= SAFE_MARGIN
  if (panel.x < minSpacing - 1) {
    recordIssue(panel.label, ''left-edge'', panel.x, `>= ${minSpacing}px`)
  }
  // 右边缘：必须 >= SAFE_MARGIN
  const rightEdge = viewportWidth.value - (panel.x + panel.width)
  if (rightEdge < minSpacing - 1) {
    recordIssue(panel.label, ''right-edge'', rightEdge, `>= ${minSpacing}px`)
  }
  // 下边缘：必须 >= SAFE_MARGIN
  const bottomEdge = viewportHeight.value - (panel.y + panel.height)
  if (bottomEdge < minSpacing - 1) {
    recordIssue(panel.label, ''bottom-edge'', bottomEdge, `>= ${minSpacing}px`)
  }
}

/**
 * 执行所有对齐验证
 * V2 变更：移除 Container/TopArea 验证，新增间距验证
 */
function validateAlignment() {
  alignmentIssues.value = []

  // 验证 Panel 的 Cell 对齐
  measuredPanels.value.forEach((panel) => validateRect(panel.label, panel))

  // 验证 Panel 到 Canvas 边缘的间距
  measuredPanels.value.forEach((panel) => validateEdgeSpacing(panel))

  // 验证 Dock 居中和 Cell 对齐
  if (measuredDock.value) {
    validateRect(''Dock'', measuredDock.value, { skipY: true })
    validateDockCenter(measuredDock.value)
  }
}

// 窗口大小变化时重新测量
function handleResize() {
  updateViewport()
  measureAll()
}

onMounted(() => {
  window.addEventListener(''resize'', handleResize)
  // 首次开启时 DOM 可能尚未完全渲染，延迟测量
  if (props.enabled) {
    requestAnimationFrame(measureAll)
  }
})

onUnmounted(() => {
  window.removeEventListener(''resize'', handleResize)
})

// 当检查模式开启时重新测量
watch(
  () => props.enabled,
  (enabled) => {
    if (enabled) {
      requestAnimationFrame(measureAll)
    }
  },
)

// 计算 Grid 参考线行列数（V2 使用 GRID_SIZE 而非 cellPixel）
const gridCols = computed(() => Math.floor(viewportWidth.value / GRID_SIZE))
const gridRows = computed(() => Math.floor(viewportHeight.value / GRID_SIZE))

// 生成 Grid 参考线数据（V2 使用 GRID_SIZE）
const gridLines = computed(() => {
  const result = []
  for (let row = 0; row < gridRows.value; row++) {
    for (let col = 0; col < gridCols.value; col++) {
      result.push({
        id: `${row}-${col}`,
        row,
        col,
        x: col * GRID_SIZE,
        y: row * GRID_SIZE,
      })
    }
  }
  return result
})

// 对齐状态摘要
const alignmentStatus = computed(() => {
  return alignmentIssues.value.length === 0 ? ''PASS'' : `FAIL (${alignmentIssues.value.length})`
})
</script>

<template>
  <div v-if="enabled" class="gcs-inspection-overlay">
    <!-- Grid 参考线层（V2 使用 GRID_SIZE = 100px） -->
    <svg class="cell-grid" :width="viewportWidth" :height="viewportHeight">
      <g class="cell-boundaries">
        <line
          v-for="col in gridCols + 1"
          :key="`v-${col}`"
          :x1="(col - 1) * GRID_SIZE"
          :y1="0"
          :x2="(col - 1) * GRID_SIZE"
          :y2="viewportHeight"
          stroke="#ff6b6b"
          stroke-width="1"
          stroke-dasharray="4,4"
          opacity="0.4"
        />
        <line
          v-for="row in gridRows + 1"
          :key="`h-${row}`"
          :x1="0"
          :y1="(row - 1) * GRID_SIZE"
          :x2="viewportWidth"
          :y2="(row - 1) * GRID_SIZE"
          stroke="#ff6b6b"
          stroke-width="1"
          stroke-dasharray="4,4"
          opacity="0.4"
        />
      </g>

      <g class="cell-labels">
        <text
          v-for="cell in gridLines"
          :key="cell.id"
          :x="cell.x + 4"
          :y="cell.y + 14"
          fill="#ff6b6b"
          font-size="10"
          font-family="monospace"
          opacity="0.6"
        >
          {{ cell.row }},{{ cell.col }}
        </text>
      </g>
    </svg>

    <!-- Panel 占用区域 -->
    <div
      v-for="panel in measuredPanels"
      :key="panel.id"
      class="panel-boundary"
      :class="{ misaligned: alignmentIssues.some((i) => i.name === panel.label) }"
      :style="{
        top: `${panel.y}px`,
        left: `${panel.x}px`,
        width: `${panel.width}px`,
        height: `${panel.height}px`,
      }"
    >
      <div class="panel-label">{{ panel.label }}</div>
    </div>

    <!-- Dock 占用区域 -->
    <div
      v-if="measuredDock"
      class="dock-boundary"
      :class="{ misaligned: alignmentIssues.some((i) => i.name === ''Dock'') }"
      :style="{
        top: `${measuredDock.y}px`,
        left: `${measuredDock.x}px`,
        width: `${measuredDock.width}px`,
        height: `${measuredDock.height}px`,
      }"
    >
      <div class="dock-label">
        Dock ({{ Math.round(measuredDock.width / cellPixel) }}×{{
          Math.round(measuredDock.height / cellPixel)
        }})
      </div>
    </div>

    <!-- 参数信息面板 -->
    <div class="info-panel">
      <div class="info-title">GCS Inspection Mode</div>
      <div class="info-item">
        <span class="info-label">CELL_PIXEL:</span>
        <span class="info-value">{{ cellPixel }}px</span>
      </div>
      <div class="info-item">
        <span class="info-label">GAP:</span>
        <span class="info-value">{{ gap }}px</span>
      </div>
      <div class="info-item">
        <span class="info-label">PADDING:</span>
        <span class="info-value">{{ padding }}px</span>
      </div>
      <div class="info-item">
        <span class="info-label">SAFE_MARGIN:</span>
        <span class="info-value">{{ SAFE_MARGIN }}px</span>
      </div>
      <div class="info-item">
        <span class="info-label">PANEL_SPACING:</span>
        <span class="info-value">{{ PANEL_SPACING }}px</span>
      </div>
      <div class="info-item">
        <span class="info-label">GRID_SIZE:</span>
        <span class="info-value">{{ GRID_SIZE }}px</span>
      </div>
      <div class="info-item">
        <span class="info-label">Grid:</span>
        <span class="info-value">{{ gridCols }}×{{ gridRows }}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Alignment:</span>
        <span class="info-value" :class="alignmentStatus === ''PASS'' ? ''pass'' : ''fail''">
          {{ alignmentStatus }}
        </span>
      </div>

      <!-- 对齐问题列表 -->
      <div v-if="alignmentIssues.length > 0" class="issues-list">
        <div v-for="(issue, index) in alignmentIssues" :key="index" class="issue-item">
          {{ issue.name }} {{ issue.field }}={{ issue.value }}px (expected {{ issue.expected }})
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gcs-inspection-overlay {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 55;
}

/* 信息面板需要可交互（如果有交互元素） */
.info-panel {
  pointer-events: auto;
}

.cell-grid {
  position: absolute;
  inset: 0;
}

.panel-boundary {
  position: absolute;
  border: 2px dashed #ffa502;
  background: rgba(255, 165, 2, 0.08);
  pointer-events: none;
}

.panel-boundary.misaligned {
  border-color: #ff3838;
  background: rgba(255, 56, 56, 0.1);
}

.panel-label {
  position: absolute;
  top: v-bind(labelOffsetCss);
  left: v-bind(labelOffsetCss);
  color: #ffa502;
  font-size: v-bind(labelFontSizeSmallCss);
  font-family: monospace;
  font-weight: bold;
  background: rgba(0, 0, 0, 0.6);
  padding: v-bind(labelPaddingCss);
  border-radius: 3px;
}

.dock-boundary {
  position: absolute;
  border: 2px solid #ff6b6b;
  background: rgba(255, 107, 107, 0.08);
  pointer-events: none;
}

.dock-boundary.misaligned {
  border-color: #ff3838;
  background: rgba(255, 56, 56, 0.1);
}

.dock-label {
  position: absolute;
  top: v-bind(labelOffsetCss);
  left: v-bind(labelOffsetCss);
  color: #ff6b6b;
  font-size: v-bind(labelFontSizeMediumCss);
  font-family: monospace;
  font-weight: bold;
  background: rgba(0, 0, 0, 0.6);
  padding: v-bind(labelPaddingCss);
  border-radius: 3px;
}

.info-panel {
  position: absolute;
  top: v-bind(infoPanelOffsetCss);
  right: v-bind(infoPanelOffsetCss);
  background: rgba(0, 0, 0, 0.85);
  color: #fff;
  padding: v-bind(infoPanelPaddingCss);
  border-radius: 8px;
  font-family: monospace;
  font-size: v-bind(infoPanelFontSizeCss);
  min-width: v-bind(infoPanelMinWidthCss);
  max-width: 320px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.info-title {
  font-size: v-bind(infoTitleFontSizeCss);
  font-weight: bold;
  margin-bottom: v-bind(infoTitleMarginCss);
  color: #ffd93d;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  padding-bottom: v-bind(infoTitlePaddingCss);
}

.info-item {
  display: flex;
  justify-content: space-between;
  margin-bottom: v-bind(infoItemMarginCss);
}

.info-label {
  color: #95a5a6;
}

.info-value {
  color: #2ecc71;
  font-weight: bold;
}

.info-value.pass {
  color: #2ecc71;
}

.info-value.fail {
  color: #ff3838;
}

.issues-list {
  margin-top: v-bind(infoItemMarginCss);
  padding-top: v-bind(infoItemMarginCss);
  border-top: 1px solid rgba(255, 255, 255, 0.2);
}

.issue-item {
  color: #ff3838;
  font-size: v-bind(labelFontSizeSmallCss);
  margin-bottom: 4px;
  word-break: break-all;
}
</style>
```

## src/core/layout/components/GcsPanel.vue

```vue
<script setup>
/**
 * GcsPanel - GCS V2 Panel 容器
 *
 * 统一视觉语言：
 * - 位置和尺寸基于 anchor + offset + w + h 的 PPS 定位系统
 * - 圆角 = CELL_PIXEL × 0.15
 * - 白色实体背景 + 轻阴影
 *
 * V2 变更：
 * - 移除 x/y props（旧 Grid 坐标）
 * - 新增 anchor/offsetX/offsetY props（PPS 定位）
 * - 位置由 useGCS().panelPosition() 计算
 *
 * Props:
 * - w: 横向 Cell 数（必须）
 * - h: 纵向 Cell 数（必须）
 * - anchor: 锚点（默认 'top-left''）
 * - offsetX: 水平偏移（Cell 单位，默认 0）
 * - offsetY: 垂直偏移（Cell 单位，默认 0）
 */

import { computed } from ''vue''
import { useGCS } from ''../useGCS.js''

const props = defineProps({
  w: { type: Number, required: true },
  h: { type: Number, required: true },
  anchor: {
    type: String,
    default: ''top-left'',
    validator: (v) =>
      [
        ''top-left'',
        ''top-right'',
        ''top-center'',
        ''bottom-center'',
        ''bottom-left'',
        ''bottom-right'',
      ].includes(v),
  },
  offsetX: { type: Number, default: 0 },
  offsetY: { type: Number, default: 0 },
})

const { cellPixel, panelPosition } = useGCS()

/**
 * 计算 Panel 的 CSS 样式
 * 通过 panelPosition 函数获取位置和尺寸
 */
const panelStyle = computed(() => {
  const pos = panelPosition(props.w, props.h, props.anchor, props.offsetX, props.offsetY)
  // 最后一层防御：如果计算出的宽高为 0，用 cell 单位 × 默认 80px 兜底
  const wPx = parseFloat(pos.width) || (props.w * 80)
  const hPx = parseFloat(pos.height) || (props.h * 80)
  return {
    position: ''absolute'',
    left: pos.left || ''20px'',
    top: pos.top || ''20px'',
    width: `${wPx}px`,
    height: `${hPx}px`,
    minWidth: `${props.w * 80}px`,
    minHeight: `${props.h * 80}px`,
    borderRadius: `${(cellPixel.value > 0 ? cellPixel.value : 80) * 0.15}px`,
    backgroundColor: ''#ffffff'',
    boxShadow: ''0 2px 8px rgba(0, 0, 0, 0.1)'',
    boxSizing: ''border-box'',
    overflow: ''hidden'',
    pointerEvents: ''auto'',
  }
})
</script>

<template>
  <div class="gcs-panel" :style="panelStyle">
    <slot />
  </div>
</template>

<style scoped>
.gcs-panel {
  color: #fff;
}
</style>
```

## src/core/layout/components/NavButton.vue

```vue
<script>
export default { name: 'GcsNavButton'' }
</script>

<script setup>
/**
 * NavButton - 1×1 导航按钮
 *
 * 职责：
 * 1. 作为底部导航条或顶部功能区的最小导航单元
 * 2. 默认占 1×1 Panel，文字在上，图标在下
 * 3. 支持 normal / active / disabled 三种状态
 *
 * 设计说明：
 * - 本组件复用 GcsButton 的视觉与交互逻辑，仅固定尺寸为 1×1
 * - 避免与 GcsButton 重复实现样式，保持平台按钮风格统一
 *
 * Props:
 * - label: 按钮文字
 * - icon: 图标字符（可选）
 * - disabled: 是否禁用
 * - active: 是否处于激活/选中态
 */

import GcsButton from ''./GcsButton.vue''

defineProps({
  label: { type: String, default: '''' },
  icon: { type: String, default: '''' },
  disabled: { type: Boolean, default: false },
  active: { type: Boolean, default: false },
})

defineEmits([''click''])
</script>

<template>
  <GcsButton
    :w="0.8"
    :h="0.8"
    :label="label"
    :icon="icon"
    :disabled="disabled"
    :active="active"
    @click="$emit(''click'')"
  />
</template>
```

## src/core/layout/useGCS.js

```javascript
import { computed, ref } from 'vue''
import { CELL_PADDING, GAP, PANEL_SPACING, SAFE_MARGIN, getCellPixelByViewport } from ''./config.js''

const windowWidth = ref(typeof window !== ''undefined'' ? window.innerWidth : 1920)
const windowHeight = ref(typeof window !== ''undefined'' ? window.innerHeight : 1080)
const cellPixel = ref(getCellPixelByViewport(windowWidth.value))
let resizeTimer = null
let listenerRegistered = false

function updateCellPixel() {
  const w = typeof window !== ''undefined'' ? window.innerWidth : 1920
  windowWidth.value = w
  windowHeight.value = typeof window !== ''undefined'' ? window.innerHeight : 1080
  cellPixel.value = getCellPixelByViewport(w)
}

function onResize() {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(updateCellPixel, 150)
}

function ensureResizeListener() {
  if (listenerRegistered || typeof window === ''undefined'') return
  window.addEventListener(''resize'', onResize)
  listenerRegistered = true
}

export function useGCS() {
  ensureResizeListener()

  // 防御：cellPixel/windowWidth 非法时重算，解决路由切换后 Panel 不可见
  const ww = windowWidth.value
  const cp = cellPixel.value
  if (cp <= 0 || !isFinite(cp) || ww <= 0 || !isFinite(ww)) {
    updateCellPixel()
    // 若重算后仍无效，设定最低兜底值
    if (cellPixel.value <= 0) cellPixel.value = 80
    if (windowWidth.value <= 0) windowWidth.value = 1920
  }

  // Panel 间距 = 2 × GAP = 20px（V2 新增）
  const panelSpacing = computed(() => PANEL_SPACING)

  // Panel 到 Canvas 边缘距离 = PANEL_SPACING = 20px（V2 新增）
  const safeMargin = computed(() => SAFE_MARGIN)

  // 基础间距单位 = GAP = 10px（用于 Grid 参考线计算）
  const gap = computed(() => GAP)

  /**
   * 响应式显隐控制
   * - showPanels: 是否显示左右 Panel 组（可视化 / 图层控制 / 结果展示）
   * - showTopArea: 是否显示顶部 Panel 组（Title + 城市按钮）
   * - 底部导航条始终显示，确保任何尺寸下都能切换业务
   */
  const showPanels = computed(() => windowWidth.value >= 768)
  const showTopArea = computed(() => windowWidth.value >= 768)

  /**
   * 计算 w×h 个 Cell 占据的总尺寸（CSS 字符串格式）
   * @param {number} w - 横向 Cell 数
   * @param {number} h - 纵向 Cell 数
   * @returns {{ width: string, height: string }}
   */
  function cell(w, h) {
    return {
      width: `${w * cellPixel.value}px`,
      height: `${h * cellPixel.value}px`,
    }
  }

  /**
   * 计算 w×h 个 Cell 占据的像素尺寸（数值格式）
   * @param {number} w - 横向 Cell 数
   * @param {number} h - 纵向 Cell 数
   * @returns {{ width: number, height: number }}
   */
  function cellSize(w, h) {
    return {
      width: w * cellPixel.value,
      height: h * cellPixel.value,
    }
  }

  /**
   * 计算 Panel 内部内容区域的像素尺寸（数值格式）
   * @param {number} w - 横向 Cell 数
   * @param {number} h - 纵向 Cell 数
   * @returns {{ width: number, height: number }}
   */
  function panelContentSize(w, h) {
    return {
      width: w * cellPixel.value - 2 * CELL_PADDING,
      height: h * cellPixel.value - 2 * CELL_PADDING,
    }
  }

  /**
   * Panel Position System - 根据锚点和偏移计算 Panel 像素位置
   *
   * @param {number} w - Panel 宽度（Cell 单位）
   * @param {number} h - Panel 高度（Cell 单位）
   * @param {string} anchor - 锚点: ''top-left'' | ''top-right'' | ''top-center'' |
   *                          ''bottom-center'' | ''bottom-left'' | ''bottom-right''
   * @param {number} offsetX - 水平偏移（Cell 单位，默认 0）
   * @param {number} offsetY - 垂直偏移（Cell 单位，默认 0）
   * @returns {{ left: string, top: string, width: string, height: string }}
   *
   * 公式说明：
   *   C = cellPixel.value（当前 Cell 像素值）
   *   S = PANEL_SPACING（Panel 间距 = 20px）
   *   W = windowWidth.value（视口宽度）
   *   H = windowHeight.value（视口高度）
   *
   *   top-left:      left = S + offsetX*C,          top = S + offsetY*C
   *   top-right:     left = W - S - (offsetX+w)*C,  top = S + offsetY*C
   *   top-center:    left = (W - w*C) / 2,          top = S + offsetY*C
   *   bottom-center: left = (W - w*C) / 2,          top = H - S - (offsetY+h)*C
   *   bottom-left:   left = S + offsetX*C,          top = H - S - (offsetY+h)*C
   *   bottom-right:  left = W - S - (offsetX+w)*C,  top = H - S - (offsetY+h)*C
   */
  function panelPosition(w, h, anchor, offsetX = 0, offsetY = 0) {
    // 所有关键值都加兜底，防止 NaN 或 0 导致面板不可见
    const C = cellPixel.value > 0 ? cellPixel.value : 80
    const S = PANEL_SPACING
    const W = windowWidth.value > 0 ? windowWidth.value : 1920
    const H = windowHeight.value > 0 ? windowHeight.value : 1080

    let left, top

    switch (anchor) {
      case ''top-left'':
        left = S + offsetX * C
        top = S + offsetY * C
        break
      case ''top-right'':
        left = W - S - (offsetX + w) * C
        top = S + offsetY * C
        break
      case ''top-center'':
        left = (W - w * C) / 2
        top = S + offsetY * C
        break
      case ''bottom-center'':
        left = (W - w * C) / 2
        top = H - S - (offsetY + h) * C
        break
      case ''bottom-left'':
        left = S + offsetX * C
        top = H - S - (offsetY + h) * C
        break
      case ''bottom-right'':
        left = W - S - (offsetX + w) * C
        top = H - S - (offsetY + h) * C
        break
      default:
        // FIX:017 (错误): 仅在开发环境输出警告
        if (import.meta.env.DEV) {
          console.warn(`[GCS] Unknown anchor: ${anchor}, fallback to top-left`)
        }
        left = S
        top = S
    }

    return {
      left: `${left}px`,
      top: `${top}px`,
      width: `${w * C}px`,
      height: `${h * C}px`,
    }
  }

  /**
   * CSS 尺寸工具集（用于 v-bind() 场景）
   * 提供常用尺寸的字符串格式，避免组件重复写计算属性
   * 使用方式：const { css } = useGCS(); 在 CSS 中 v-bind(css.cell8px)
   */
  const css = {
    // 间距尺寸
    /** 8px = 0.1 cell */
    cell8px: computed(() => `${cellPixel.value * 0.1}px`),
    /** 16px = 0.2 cell */
    cell16px: computed(() => `${cellPixel.value * 0.2}px`),
    /** 40px = 0.5 cell */
    cell40px: computed(() => `${cellPixel.value * 0.5}px`),
    // FIX:R-04: 字号固定 px，与 cell 网格解耦（GCS_V2 规范：16/14/12px）
    fontSizeTitle: computed(() => ''16px''),
    fontSizeBody: computed(() => ''14px''),
    fontSizeSmall: computed(() => ''12px''),
  }

  /**
   * 根据当前视口更新 CELL_PIXEL 和视口尺寸
   */
  function updateCellPixel() {
    windowWidth.value = window.innerWidth
    windowHeight.value = window.innerHeight // V2 新增
    cellPixel.value = getCellPixelByViewport(windowWidth.value)
  }

  /**
   * 防抖 resize 处理（150ms）
   */
  return {
    windowWidth,
    windowHeight, // V2 新增
    cellPixel,
    gap,
    panelSpacing, // V2 新增
    safeMargin, // V2 新增
    padding: CELL_PADDING,
    showPanels,
    showTopArea,
    cell,
    cellSize,
    panelContentSize,
    panelPosition, // V2 新增：PPS 引擎核心函数
    css, // V2 新增：CSS v-bind() 专用工具（保留向后兼容）
    // V2 优化：直接平铺 CSS 变量，避免组件二次解构
    cell8px: css.cell8px,
    cell16px: css.cell16px,
    cell40px: css.cell40px,
    fontSizeTitle: css.fontSizeTitle,
    fontSizeBody: css.fontSizeBody,
    fontSizeSmall: css.fontSizeSmall,
  }
}
```

## Store 状态管理

## src/stores/floodState.js

```javascript
import { defineStore } from 'pinia''
import { ref } from ''vue''

/**
 * floodState - 浸没分析状态保存/恢复 Store
 *
 * 用途：
 * - P2-2: 跳转到个人中心页时保存当前分析状态，返回时恢复
 * - FIX:P3-3: 从个人中心加载历史浸没方案时保存方案数据，跳转后恢复
 *
 * 触发条件：
 * - 仅当从浸没分析页跳转到个人中心（/profile）时保存状态
 * - 跳转到其他路由（首页、其他业务页）时清除状态
 * - 从个人中心返回浸没分析页时恢复状态
 */
export const useFloodStateStore = defineStore(''floodState'', () => {
  const hasState = ref(false)

  const waterLevel = ref(0)
  const floodStatistics = ref(null)
  const floodFeatures = ref([])
  const floodRiskLevel = ref(''无风险'')
  const affectedFacilities = ref([])
  const totalLoss = ref(0)

  function saveState(data) {
    waterLevel.value = data.waterLevel
    floodStatistics.value = data.floodStatistics
    floodFeatures.value = data.floodFeatures
    floodRiskLevel.value = data.floodRiskLevel ?? ''无风险'' // FIX:P2-03: 兼容缺省
    affectedFacilities.value = data.affectedFacilities
    totalLoss.value = data.totalLoss
    hasState.value = true
  }

  function consumeState() {
    if (!hasState.value) return null

    const state = {
      waterLevel: waterLevel.value,
      floodStatistics: floodStatistics.value,
      floodFeatures: floodFeatures.value,
      floodRiskLevel: floodRiskLevel.value,
      affectedFacilities: affectedFacilities.value,
      totalLoss: totalLoss.value,
    }

    clearState()
    return state
  }

  function clearState() {
    hasState.value = false
    waterLevel.value = 0
    floodStatistics.value = null
    floodFeatures.value = []
    floodRiskLevel.value = ''无风险''
    affectedFacilities.value = []
    totalLoss.value = 0
  }

  return {
    hasState,
    saveState,
    consumeState,
    clearState,
  }
})
```

## src/stores/floodStore.js

```javascript
import { defineStore } from 'pinia''
import { ref } from ''vue''

export const useFloodStore = defineStore(''flood'', () => {
  const floodActive = ref(false)
  const showFloodArea = ref(false)
  const showFloodPOI = ref(false)
  const floodStatistics = ref(null)
  const floodFeatures = ref([])
  const floodRiskLevel = ref('''')

  function startFloodAnalysis(statistics, features, riskLevel) {
    floodActive.value = true
    showFloodArea.value = true
    showFloodPOI.value = true
    floodStatistics.value = statistics || null
    floodFeatures.value = features || []
    floodRiskLevel.value = riskLevel || ''''
  }

  function resetFloodAnalysis() {
    floodActive.value = false
    showFloodArea.value = false
    showFloodPOI.value = false
    floodStatistics.value = null
    floodFeatures.value = []
    floodRiskLevel.value = ''''
  }

  return {
    floodActive,
    showFloodArea,
    showFloodPOI,
    floodStatistics,
    floodFeatures,
    floodRiskLevel,
    startFloodAnalysis,
    resetFloodAnalysis,
  }
})
```

## src/stores/forecastState.js

```javascript
// 与现有 store 一致，使用 .js 文件 + Pinia setup store 模式
import { defineStore } from 'pinia''
import { ref, computed } from ''vue''

export const useForecastState = defineStore(''forecast'', () => {
  // ==================== 时间状态 ====================
  const currentTime = ref(''2025-12'')

  const timeRange = ref({
    start: ''2023-01'',
    end: ''2035-12'',
    current: ''2025-12'',
  })

  const timeGranularity = ref(''month'')

  const isPlaying = ref(false)

  const playSpeed = ref(500)

  // ==================== 指标状态 ====================
  const activeIndicator = ref(''throughput'')

  // TODO:6.3: 每个指标独立的置信度阈值
  const confidenceThresholds = ref({
    throughput: 0.8,
    berth: 0.8,
    traffic: 0.8,
    pressure: 0.8,
  })

  const activeForecastLayer = ref(null)

  // ==================== 数据状态 ====================
  // TODO:3.1: dataCache 用于 TODO:5.1 的数据流桥接（偏差4）
  const dataCache = ref(new Map())

  const currentData = computed(() => {
    return dataCache.value.get(currentTime.value) || null
  })

  // ==================== Actions ====================
  function setCurrentTime(time) {
    currentTime.value = time
  }

  function setTimeGranularity(granularity) {
    timeGranularity.value = granularity
  }

  function setActiveIndicator(indicator) {
    activeIndicator.value = indicator
  }

  function setConfidenceThreshold(indicator, value) {
    confidenceThresholds.value[indicator] = value
  }

  function cacheData(time, data) {
    dataCache.value.set(time, data)
  }

  function clearCache() {
    dataCache.value.clear()
  }

  function reset() {
    currentTime.value = ''2025-12''
    activeIndicator.value = ''throughput''
    activeForecastLayer.value = null
    isPlaying.value = false
    clearCache()
  }

  return {
    currentTime,
    timeRange,
    timeGranularity,
    isPlaying,
    playSpeed,
    activeIndicator,
    confidenceThresholds,
    activeForecastLayer,
    dataCache,
    currentData,
    setCurrentTime,
    setTimeGranularity,
    setActiveIndicator,
    setConfidenceThreshold,
    cacheData,
    clearCache,
    reset,
  }
})
```

## src/stores/gcsStore.js

```javascript
import { defineStore } from 'pinia''
import { useWaterLevelStore } from ''./waterLevelStore''
import { useProfileStore } from ''./profileStore''
import { useFloodStore } from ''./floodStore''
import { usePortImpactStore } from ''./portImpactStore''

export const useGcsStore = defineStore(''gcs'', () => {
  const waterLevelStore = useWaterLevelStore()
  const profileStore = useProfileStore()
  const floodStore = useFloodStore()
  const portImpactStore = usePortImpactStore()

  function resetAll() {
    waterLevelStore.resetWaterLevel()
    profileStore.resetProfile()
    floodStore.resetFloodAnalysis()
    portImpactStore.resetPortImpact()
  }

  return { resetAll }
})
```

## src/stores/map.js

```javascript
import { defineStore } from 'pinia''
import { shallowRef, ref } from ''vue''

/** localStorage 键：底图、地图类型、选中港口；sessionStorage：分析结果 */
const BASE_LAYER_STORAGE_KEY = ''beibu-gulf-base-layer''
const MAP_TYPE_STORAGE_KEY = ''beibu-gulf-map-type''
const SELECTED_PORT_STORAGE_KEY = ''beibu-gulf-selected-port''
const ANALYSIS_RESULT_STORAGE_KEY = ''beibu-gulf-analysis-result''

function readStoredBaseLayer() {
  if (typeof window === ''undefined'') return null
  try {
    return window.localStorage.getItem(BASE_LAYER_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredBaseLayer(key) {
  if (typeof window === ''undefined'') return
  try {
    window.localStorage.setItem(BASE_LAYER_STORAGE_KEY, key)
  } catch {
    // 忽略隐私模式等写入失败场景
  }
}

function writeStoredMapType(type) {
  if (typeof window === ''undefined'') return
  try {
    window.localStorage.setItem(MAP_TYPE_STORAGE_KEY, type)
  } catch {
    // 忽略隐私模式等写入失败场景
  }
}

function writeStoredSelectedPort(port) {
  if (typeof window === ''undefined'') return
  try {
    if (port) {
      window.localStorage.setItem(SELECTED_PORT_STORAGE_KEY, JSON.stringify(port))
    } else {
      window.localStorage.removeItem(SELECTED_PORT_STORAGE_KEY)
    }
  } catch {
    // 忽略隐私模式等写入失败场景
  }
}

function readStoredAnalysisResult() {
  if (typeof window === ''undefined'') return null
  try {
    const stored = window.sessionStorage.getItem(ANALYSIS_RESULT_STORAGE_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

function writeStoredAnalysisResult(result) {
  if (typeof window === ''undefined'') return
  try {
    if (result) {
      window.sessionStorage.setItem(ANALYSIS_RESULT_STORAGE_KEY, JSON.stringify(result))
    } else {
      window.sessionStorage.removeItem(ANALYSIS_RESULT_STORAGE_KEY)
    }
  } catch {
    // 忽略隐私模式等写入失败场景
  }
}

export const useMapStore = defineStore(''map'', () => {
  const map = shallowRef(null)
  const selectedPort = ref(null)
  const mapType = ref(''2d'')
  const layerCatalog = ref([])
  const baseLayerKey = ref(readStoredBaseLayer())

  /** 当前渲染器引用（由UnifiedMap设置，供业务组件访问） */
  const currentRenderer = shallowRef(null)

  const analysisHandler = ref(null)
  // FIX:003 (状态): 从 sessionStorage 恢复分析结果
  const lastAnalysisResult = ref(readStoredAnalysisResult())

  const activePanel = ref(''none'')
  const selectedXiaoqu = ref(null)

  function setMap(instance) {
    map.value = instance
  }

  // 由 UnifiedMap 在渲染器初始化/切换时调用
  function setCurrentRenderer(renderer) {
    currentRenderer.value = renderer
  }

  // FIX:012: 删除重复函数，保留 setMapType
  // FIX:004 (状态): 持久化地图类型
  function setMapType(type) {
    mapType.value = type
    writeStoredMapType(type)
  }

  function setSelectedPort(port) {
    selectedPort.value = port
    writeStoredSelectedPort(port)
  }

  function clearSelectedPort() {
    selectedPort.value = null
    writeStoredSelectedPort(null)
  }

  function registerAnalysisHandler(handler) {
    // FIX:023: 验证handler是否为函数
    if (typeof handler !== ''function'') {
      if (import.meta.env.DEV) {
        console.warn(''registerAnalysisHandler: handler必须是函数类型'')
      }
      return
    }
    analysisHandler.value = handler
    if (lastAnalysisResult.value) {
      handler(lastAnalysisResult.value)
    }
  }

  function setAnalysisResult(result) {
    lastAnalysisResult.value = result
    // FIX:003 (状态): 持久化分析结果到 sessionStorage
    writeStoredAnalysisResult(result)
    // FIX:015: 验证 analysisHandler 是否为函数
    if (typeof analysisHandler.value === ''function'') {
      analysisHandler.value(result)
    }
  }

  function registerLayer(key, label, options) {
    const { visible = false, category = ''business'', show, hide } = options

    const existingIndex = layerCatalog.value.findIndex((e) => e.key === key)
    if (existingIndex >= 0) {
      const existing = layerCatalog.value[existingIndex]
      if (show) existing.show.push(show)
      if (hide) existing.hide.push(hide)
    } else {
      layerCatalog.value.push({
        key,
        label,
        visible,
        category,
        show: show ? [show] : [() => {}],
        hide: hide ? [hide] : [() => {}],
      })
    }
  }

  function registerBaseLayer(key, label, show, hide) {
    const existing = layerCatalog.value.find((e) => e.key === key)
    const isFirstBase = layerCatalog.value.every((e) => e.category !== ''base'')
    // 优先以 localStorage 中持久化的底图 key 为准；未设置时默认第一个底图可见
    const storedKey = baseLayerKey.value
    const shouldVisible = existing ? existing.visible : storedKey ? key === storedKey : isFirstBase

    const wrappedShow = () => {
      layerCatalog.value
        .filter((e) => e.category === ''base'' && e.key !== key)
        .forEach((e) => {
          e.visible = false
          e.hide.forEach((fn) => fn())
        })
      baseLayerKey.value = key
      writeStoredBaseLayer(key)
      show()
    }

    registerLayer(key, label, {
      visible: shouldVisible,
      category: ''base'',
      show: wrappedShow,
      hide,
    })

    if (shouldVisible) {
      wrappedShow()
    }
  }

  function registerToggleable(key, label, show, hide, visible = true) {
    const existing = layerCatalog.value.find((e) => e.key === key)
    const shouldVisible = existing ? existing.visible : visible

    registerLayer(key, label, {
      visible: shouldVisible,
      category: ''business'',
      show,
      hide,
    })

    if (shouldVisible) {
      show()
    }
  }

  /**
   * 注册业务图层到 layerCatalog
   *
   * 与 registerToggleable 不同：
   * - 不存储 show/hide 回调函数
   * - 不触发 toggle，直接设 visible
   * - catalog 条目只有元数据（key/label/layerType/visible/category）
   * - LayerControlPanel 只读此条目，不做渲染操作
   *
   * @param {string} key
   * @param {string} label
   * @param {string} layerType
   * @param {boolean} visible
   */
  function registerBusinessLayer(key, label, layerType, visible = true) {
    const existing = layerCatalog.value.find((e) => e.key === key)
    if (existing) {
      existing.visible = visible
      existing.layerType = layerType
      return
    }
    layerCatalog.value.push({
      key,
      label,
      layerType,
      visible,
      category: ''business'',
    })
  }

  function toggleLayer(key) {
    const entry = layerCatalog.value.find((e) => e.key === key)
    // FIX:024: 验证entry存在性
    if (!entry) {
      if (import.meta.env.DEV) {
        console.warn(`toggleLayer: 未找到key为"${key}"的图层`)
      }
      return
    }

    if (entry.category === ''base'') {
      handleBaseLayerToggle(entry)
    } else {
      handleBusinessLayerToggle(entry)
    }
  }

  function handleBaseLayerToggle(entry) {
    if (entry.visible) {
      // 底图必须保留一个可见，避免地图无背景
      return
    }

    layerCatalog.value
      .filter((e) => e.category === ''base'')
      .forEach((e) => {
        e.visible = false
        e.hide.forEach((fn) => fn())
      })

    entry.visible = true
    baseLayerKey.value = entry.key
    writeStoredBaseLayer(entry.key)
    entry.show.forEach((fn) => fn())
  }

  function handleBusinessLayerToggle(entry) {
    entry.visible = !entry.visible

    if (entry.visible) {
      entry.show.forEach((fn) => fn())
    } else {
      entry.hide.forEach((fn) => fn())
    }
  }

  function removeLayer(key) {
    const idx = layerCatalog.value.findIndex((e) => e.key === key)
    if (idx < 0) return
    const entry = layerCatalog.value[idx]
    // 旧机制图层（registerToggleable）有 show/hide 回调，新机制（registerBusinessLayer）没有
    if (entry.hide) {
      entry.hide.forEach((fn) => fn())
    }
    layerCatalog.value.splice(idx, 1)
  }

  function clearLayerCatalog() {
    layerCatalog.value = []
  }

  function setActivePanel(panelName) {
    if (activePanel.value === panelName) {
      activePanel.value = ''none''
    } else {
      activePanel.value = panelName
      if (panelName === ''port-info'') {
        selectedXiaoqu.value = null
      }
    }
  }

  function closePanel() {
    activePanel.value = ''none''
    selectedXiaoqu.value = null
  }

  function setSelectedXiaoqu(xiaoqu) {
    selectedXiaoqu.value = xiaoqu
  }

  return {
    map,
    mapType,
    selectedPort,
    layerCatalog,
    baseLayerKey,
    currentRenderer,
    analysisHandler,
    activePanel,
    selectedXiaoqu,
    setMap,
    setCurrentRenderer,
    setMapType,
    setSelectedPort,
    clearSelectedPort,
    registerAnalysisHandler,
    setAnalysisResult,
    registerLayer,
    registerBaseLayer,
    registerToggleable,
    registerBusinessLayer,
    toggleLayer,
    removeLayer,
    clearLayerCatalog,
    setActivePanel,
    closePanel,
    setSelectedXiaoqu,
  }
})
```

## src/stores/portImpactStore.js

```javascript
import { defineStore } from 'pinia''
import { ref } from ''vue''

export const usePortImpactStore = defineStore(''portImpact'', () => {
  const portImpactActive = ref(false)
  const affectedFacilities = ref([])
  const totalLoss = ref(0)

  function setPortImpactResult(facilities, loss) {
    affectedFacilities.value = facilities
    totalLoss.value = loss
    portImpactActive.value = facilities.length > 0
  }

  function resetPortImpact() {
    affectedFacilities.value = []
    totalLoss.value = 0
    portImpactActive.value = false
  }

  return {
    portImpactActive,
    affectedFacilities,
    totalLoss,
    setPortImpactResult,
    resetPortImpact,
  }
})
```

## src/stores/profileStore.js

```javascript
import { defineStore } from 'pinia''
import { ref } from ''vue''

export const useProfileStore = defineStore(''profile'', () => {
  const selectedProfileId = ref(null)
  const profileActive = ref(false)

  function setSelectedProfile(profileId) {
    selectedProfileId.value = profileId
    profileActive.value = !!profileId
  }

  function resetProfile() {
    selectedProfileId.value = null
    profileActive.value = false
  }

  return {
    selectedProfileId,
    profileActive,
    setSelectedProfile,
    resetProfile,
  }
})
```

## src/stores/siteSelectionState.js

```javascript
import { defineStore } from 'pinia''
import { ref } from ''vue''

/**
 * SiteSelectionState Store - 选址分析页状态保存
 *
 * 用途：当用户从选址分析页跳转到个人中心时，保存当前页面状态，
 * 返回后可以恢复状态继续操作（无需重新分析）。
 *
 * 状态保存规则：
 * - 仅当从选址分析页跳转到个人中心（/profile）时保存状态
 * - 跳转到其他路由（首页、其他业务页）时清除状态
 * - 从个人中心返回选址分析页时恢复状态
 */

export const useSiteSelectionStateStore = defineStore(''siteSelectionState'', () => {
  /** 是否有保存的状态 */
  const hasState = ref(false)

  /** 因子选择状态（SiteFactorPanel 的 typeSettings） */
  const factorSettings = ref(null)

  /** 分析结果小区列表 */
  const matchedXiaoqu = ref([])

  /** 选中的设施类型 */
  const selectedTypes = ref([])

  /** 当前方案ID */
  const currentPlanId = ref(null)

  /** 已保存的小区ID集合 */
  const savedXiaoquIds = ref([])

  /** 设施POI数据（FIX:P1-05） */
  const facilityPoi = ref({})

  /**
   * 保存状态（跳转到个人中心前调用）
   */
  function saveState(data) {
    factorSettings.value = data.factorSettings
    matchedXiaoqu.value = data.matchedXiaoqu
    selectedTypes.value = data.selectedTypes
    currentPlanId.value = data.currentPlanId
    savedXiaoquIds.value = data.savedXiaoquIds
    facilityPoi.value = data.facilityPoi || {} // FIX:P1-05
    hasState.value = true
  }

  /**
   * 获取并清除保存的状态（恢复时调用）
   */
  function consumeState() {
    if (!hasState.value) return null

    const state = {
      factorSettings: factorSettings.value,
      matchedXiaoqu: matchedXiaoqu.value,
      selectedTypes: selectedTypes.value,
      currentPlanId: currentPlanId.value,
      savedXiaoquIds: savedXiaoquIds.value,
      facilityPoi: facilityPoi.value, // FIX:P1-05
    }

    // 清除状态，避免重复恢复
    clearState()
    return state
  }

  /**
   * 清除保存的状态
   */
  function clearState() {
    hasState.value = false
    factorSettings.value = null
    matchedXiaoqu.value = []
    selectedTypes.value = []
    currentPlanId.value = null
    savedXiaoquIds.value = []
    facilityPoi.value = {} // FIX:P1-05
  }

  return {
    hasState,
    saveState,
    consumeState,
    clearState,
  }
})
```

## src/stores/waterLevelStore.js

```javascript
import { defineStore } from 'pinia''
import { ref } from ''vue''

export const useWaterLevelStore = defineStore(''waterLevel'', () => {
  const waterLevel = ref(0)
  const waterLevelActive = ref(false)

  function setWaterLevel(level) {
    waterLevel.value = level
    waterLevelActive.value = level > 0
  }

  function resetWaterLevel() {
    waterLevel.value = 0
    waterLevelActive.value = false
  }

  return {
    waterLevel,
    waterLevelActive,
    setWaterLevel,
    resetWaterLevel,
  }
})
```

## 业务模块 - 预测分析

## src/business/forecast/ForecastPage.vue

```vue
<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue''
import { ElMessage } from ''element-plus''
import AppLayout from ''@/core/layout/AppLayout.vue''
import GcsPanel from ''@/core/layout/components/GcsPanel.vue''
import LineChart from ''@/visualization/charts/LineChart.vue''
import BarChart from ''@/visualization/charts/BarChart.vue''
import LayerControlPanel from ''@/shared/components/LayerControlPanel.vue''
import ForecastControlPanel from ''./components/ForecastControlPanel.vue''
import { useForecastState } from ''@/stores/forecastState''
import { useForecastLayer } from ''./composables/useForecastLayer''
import { useForecastRequest } from ''./composables/useForecastRequest''
import { useMapStore } from ''@/stores/map''

const forecastState = useForecastState()
const mapStore = useMapStore()
const { updateForecastLayer, removeForecastLayer, renderer } = useForecastLayer()
const { forecastApiRequest, startTransaction, cancelAll } = useForecastRequest()

const lineXData = ref([])
const lineSeries = ref([])
const barXData = ref([''钦州港'', ''北海港'', ''防城港''])
const barSeries = ref([])

const lineViewportXMin = ref(''2023-01'')
const lineViewportXMax = ref(''2029-12'')

// P0-5: LRU 缓存实现，限制最大 50 条目防止内存泄漏
const MAX_CACHE_SIZE = 50
const requestCache = new Map()

function cacheSet(key, value) {
  // 如果已存在，先删除旧条目（更新位置）
  if (requestCache.has(key)) {
    requestCache.delete(key)
  }
  // 如果缓存已满，删除最旧的条目（Map 的第一个键）
  if (requestCache.size >= MAX_CACHE_SIZE) {
    const firstKey = requestCache.keys().next().value
    requestCache.delete(firstKey)
  }
  requestCache.set(key, value)
}

function cacheGet(key) {
  if (!requestCache.has(key)) return undefined
  const value = requestCache.get(key)
  // 访问时更新位置（移到末尾）
  requestCache.delete(key)
  requestCache.set(key, value)
  return value
}

let debounceTimer = null
const DEBOUNCE_DELAY = 300

// P2-01: 加载状态反馈
const isLoading = ref(false)

onMounted(() => { forecastState.reset(); requestCache.clear() })

async function loadTimeSeriesData(transactionId, signal) {
  console.log(''[ForecastPage] loadTimeSeriesData called'')
  try {
    const indicator = forecastState.activeIndicator
    const granularity = forecastState.timeGranularity
    console.log(''[ForecastPage] loadTimeSeriesData:'', { indicator, granularity })
    const confidence = forecastState.confidenceThresholds[indicator] || 0.8
    const cacheKey = `ts:${indicator}:${granularity}:${confidence}`

    // 全量数据: 首次 API 获取后缓存，后续只做窗口截取
    let cached = cacheGet(cacheKey)
    if (!cached) {
      const resp = await forecastApiRequest(
        `/forecast/timeseries?indicator=${indicator}&granularity=${granularity}&confidence=${confidence}`,
        transactionId,
        signal
      )
      // 事务过期或请求被取消
      if (resp === null) return
      if (resp.code === 200 && resp.data?.series) {
        cacheSet(cacheKey, { allSeries: resp.data.series })
        cached = cacheGet(cacheKey)
      }
    }
    if (!cached?.allSeries) return

    const allData = cached.allSeries[0]?.data || []
    if (!allData.length) return

    // 7年窗口: [slider-3, slider+3]，钳制在数据实际范围内防止空白
    const [sliderYear, sliderMonth] = forecastState.currentTime.split(''-'').map(Number)
    const isYear = forecastState.timeGranularity === ''year''
    const fmt = (y, m) => isYear ? String(y) : `${y}-${String(m || 1).padStart(2, ''0'')}`
    const dataMin = allData[0].time
    const dataMax = allData[allData.length - 1].time

    const rawStart = fmt(sliderYear - 3, sliderMonth)
    const rawEnd = fmt(sliderYear + 3, 12)
    const windowStart = rawStart >= dataMin ? rawStart : dataMin
    const windowEnd = rawEnd <= dataMax ? rawEnd : dataMax

    lineViewportXMin.value = windowStart
    lineViewportXMax.value = windowEnd

    const inWindow = (d) => d.time >= windowStart && d.time <= windowEnd

    lineXData.value = allData.filter(inWindow).map((d) => d.time)
    lineSeries.value = cached.allSeries.map((s) => ({
      name: s.portName,
      data: (s.data || []).filter(inWindow).map((d) => d.value),
    }))
  } catch (e) { console.error(''[ForecastPage] loadTimeSeriesData error:'', e); ElMessage.error(''加载趋势数据失败'') }
}

async function loadPortComparisonData(transactionId, signal) {
  console.log(''[ForecastPage] loadPortComparisonData called'')
  try {
    const indicator = forecastState.activeIndicator
    const rawTime = forecastState.currentTime
    const time = rawTime.includes(''-'') ? rawTime : `${rawTime}-12`
    console.log(''[ForecastPage] loadPortComparisonData:'', { indicator, time })
    const confidence = forecastState.confidenceThresholds[indicator] || 0.8
    const cacheKey = `cmp:${indicator}:${time}:${confidence}`
    
    // P0-3: 缓存命中时也检查事务有效性，防止旧数据覆盖新数据
    let cached = cacheGet(cacheKey)
    if (cached) {
      barXData.value = cached.xData
      barSeries.value = cached.series
      return
    }
    
    const resp = await forecastApiRequest(
      `/forecast/indicator/${indicator}?time=${time}&confidence=${confidence}`,
      transactionId,
      signal
    )
    console.log(''[ForecastPage] loadPortComparisonData response:'', resp)
    // 事务过期或请求被取消
    if (resp === null) return
    if (resp.code === 200 && resp.data?.ports) {
      const p = resp.data.ports; const cy = forecastState.currentTime.split(''-'')[0]
      barXData.value = [''钦州港'', ''北海港'', ''防城港'']
      barSeries.value = [{ name: cy + ''年'', data: [p.qinzhou?.value || 0, p.beihai?.value || 0, p.fangchenggang?.value || 0] }]
      cacheSet(cacheKey, { xData: barXData.value, series: barSeries.value })
    }
  } catch (e) { console.error(''[ForecastPage] loadPortComparisonData error:'', e); ElMessage.error(''加载对比数据失败'') }
}

watch(() => mapStore.currentRenderer, (r) => {
  console.log(''[ForecastPage] renderer watch triggered:'', r ? ''renderer ready'' : ''renderer null'')
  if (r) {
    console.log(''[ForecastPage] loading data...'')
    doForecastUpdate()
  } else {
    console.log(''[ForecastPage] renderer is null, waiting...'')
  }
}, { immediate: true })

// 统一的预测更新函数：启动新事务，保证三个请求原子性
async function doForecastUpdate() {
  if (!renderer.value) return
  
  // P2-01: 设置加载状态
  isLoading.value = true
  
  try {
    // 启动新事务，取消旧请求
    const { transactionId, signal } = startTransaction()
    
    // 三个请求共享同一事务，保证数据一致性
    await Promise.all([
      loadTimeSeriesData(transactionId, signal),
      loadPortComparisonData(transactionId, signal),
      updateForecastLayer(transactionId, signal)
    ])
  } finally {
    // P2-01: 清除加载状态
    isLoading.value = false
  }
}

// P0-1c: 播放动画驱动图层更新
let playbackUpdateTimer = null
watch(
  () => forecastState.isPlaying,
  (isPlaying) => {
    if (isPlaying) {
      // 播放时启动定时器，每 1000ms 更新一次图层
      playbackUpdateTimer = setInterval(() => {
        doForecastUpdate()
      }, 1000)
    } else {
      // 停止播放时清除定时器
      if (playbackUpdateTimer) {
        clearInterval(playbackUpdateTimer)
        playbackUpdateTimer = null
      }
    }
  }
)

// 合并 watch：监听 indicator、time、confidence 三个核心状态
// P0-2: 简化为纯防抖机制，移除双触发设计，避免请求翻倍
watch(
  () => [
    forecastState.activeIndicator,
    forecastState.currentTime,
    forecastState.confidenceThresholds[forecastState.activeIndicator]
  ],
  () => {
    // 清除旧定时器，保证只有最后一次状态变化触发请求
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => doForecastUpdate(), DEBOUNCE_DELAY)
  }
)

onUnmounted(() => { 
  cancelAll()
  removeForecastLayer()
  forecastState.reset() 
})
</script>

<template>
  <div class="forecast-page" v-loading="isLoading" element-loading-text="加载预测数据中...">
    <AppLayout>
      <template #left>
        <GcsPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
          <LineChart title="预测趋势" :x-data="lineXData" :series="lineSeries" :x-min="lineViewportXMin" :x-max="lineViewportXMax" />
        </GcsPanel>
        <GcsPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="5.5">
          <BarChart title="港口对比" :x-data="barXData" :series="barSeries" />
        </GcsPanel>
      </template>
      <template #right>
        <GcsPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <ForecastControlPanel />
        </GcsPanel>
        <GcsPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
          <LayerControlPanel />
        </GcsPanel>
      </template>
    </AppLayout>
  </div>
</template>

<style scoped>
.forecast-page { width:100%; height:100%; pointer-events:none; }
.forecast-page :deep(.gcs-panel) { pointer-events:auto; }
</style>
```

## src/business/forecast/components/ForecastControlPanel.vue

```vue
<script setup>
import { reactive, computed, onMounted, onUnmounted } from 'vue''
import { useForecastState } from ''@/stores/forecastState''

const forecastState = useForecastState()
const CONFIRM_DELAY = 3000

// ===== 四个指标 =====
const INDICATORS = [
  { key: ''throughput'', label: ''吞吐量'', icon: ''📦'' },
  { key: ''berth'', label: ''泊位利用率'', icon: ''⚓'' },
  { key: ''traffic'', label: ''船舶流量'', icon: ''🚢'' },
  { key: ''pressure'', label: ''物流压力'', icon: ''📊'' },
]

const btnStates = reactive(
  Object.fromEntries(INDICATORS.map((i) => [i.key, { selected: false, selecting: false }]))
)
const timers = {}

function toggleBtn(key) {
  const s = btnStates[key]
  if (!s.selected) {
    Object.keys(btnStates).forEach((k) => { btnStates[k].selected = k === key; btnStates[k].selecting = k === key; clearTimer(k) })
    forecastState.setActiveIndicator(key)
    resetTimer(key)
  } else if (s.selected && !s.selecting) {
    s.selecting = true; resetTimer(key)
  }
}

function onSliderInput(key) { resetTimer(key) }

// P2-03: 置信度滑块防抖
let confidenceDebounceTimer = null
function onConfidenceSliderInput(key, value) {
  if (confidenceDebounceTimer) clearTimeout(confidenceDebounceTimer)
  confidenceDebounceTimer = setTimeout(() => {
    forecastState.setConfidenceThreshold(key, Number(value))
    onSliderInput(key)
  }, 300)
}
function confirmBtn(key) { if (btnStates[key].selecting) { btnStates[key].selecting = false; clearTimer(key) } }
function resetTimer(key) { clearTimer(key); timers[key] = setTimeout(() => confirmBtn(key), CONFIRM_DELAY) }
function clearTimer(key) { if (timers[key]) { clearTimeout(timers[key]); timers[key] = null } }
function confirmAll() { Object.keys(btnStates).forEach((k) => { if (btnStates[k].selecting) confirmBtn(k) }) }
function handleGlobalClick(e) { if (!e.target.closest(''.forecast-ctrl'')) confirmAll() }

function getConf(key) { return forecastState.confidenceThresholds[key] ?? 0.8 }

onMounted(() => {
  document.addEventListener(''click'', handleGlobalClick)
  btnStates.throughput.selected = true
})
onUnmounted(() => {
  document.removeEventListener(''click'', handleGlobalClick)
  Object.keys(timers).forEach(clearTimer)
})

// ===== 时间滑块 =====
const isYearMode = computed({
  get: () => forecastState.timeGranularity === ''year'',
  set: (v) => forecastState.setTimeGranularity(v ? ''year'' : ''month''),
})

const BASE_YEAR = 2023
const END_YEAR = 2035

const maxSteps = computed(() => isYearMode.value ? END_YEAR - BASE_YEAR : (END_YEAR - BASE_YEAR + 1) * 12)

const currentStep = computed(() => {
  const [y, m] = forecastState.currentTime.split(''-'').map(Number)
  return isYearMode.value ? y - BASE_YEAR : (y - BASE_YEAR) * 12 + (m - 1)
})

function stepToTime(step) {
  if (isYearMode.value) return String(BASE_YEAR + step)
  return `${BASE_YEAR + Math.floor(step / 12)}-${String((step % 12) + 1).padStart(2, ''0'')}`
}

function onSlider(e) { forecastState.setCurrentTime(stepToTime(Number(e.target.value))) }

const YEAR_MARKS = [
  { year: BASE_YEAR, step: 0, label: `${BASE_YEAR}.1` },
  { year: Math.round((BASE_YEAR + END_YEAR) / 2), step: (Math.round((BASE_YEAR + END_YEAR) / 2) - BASE_YEAR) * 12, label: `${Math.round((BASE_YEAR + END_YEAR) / 2)}.1` },
  { year: END_YEAR, step: (END_YEAR - BASE_YEAR) * 12, label: `${END_YEAR}.1` },
]

function yearMarkPosition(year) {
  if (isYearMode.value) return ((year - BASE_YEAR) / (END_YEAR - BASE_YEAR)) * 100
  return (((year - BASE_YEAR) * 12) / maxSteps.value) * 100
}

function jumpToYear(year) { forecastState.setCurrentTime(`${year}-01`) }

const displayTime = computed(() => {
  const t = forecastState.currentTime
  return isYearMode.value ? t + ''年'' : t.replace(''-'', ''年'') + ''月''
})

// ===== 播放 =====
let playbackTimer = null
function togglePlay() {
  forecastState.isPlaying = !forecastState.isPlaying
  if (forecastState.isPlaying) startPlayback()
  else stopPlayback()
}
function startPlayback() {
  playbackTimer = setInterval(() => {
    if (!forecastState.isPlaying || currentStep.value >= maxSteps.value) { forecastState.isPlaying = false; stopPlayback(); return }
    forecastState.setCurrentTime(stepToTime(currentStep.value + 1))
  }, forecastState.playSpeed)
}
function stopPlayback() { if (playbackTimer) { clearInterval(playbackTimer); playbackTimer = null } }
onUnmounted(() => stopPlayback())
</script>

<template>
  <div class="forecast-ctrl">
    <!-- ===== 上半：4 个指标按钮（2×2）===== -->
    <div class="btn-grid">
      <div
        v-for="ind in INDICATORS" :key="ind.key"
        :class="[''btn-cell'', { sel: btnStates[ind.key].selected, ing: btnStates[ind.key].selecting }]"
        @mousedown.stop
      >
        <template v-if="!btnStates[ind.key].selecting">
          <button :class="[''ind-btn'', { ok: btnStates[ind.key].selected }]" @click.stop="toggleBtn(ind.key)">
            <span class="ind-icon">{{ ind.icon }}</span>
            <span class="ind-label">{{ ind.label }}</span>
            <span v-if="btnStates[ind.key].selected" class="ind-conf">{{ (getConf(ind.key) * 100).toFixed(0) }}%</span>
          </button>
        </template>
        <div v-else class="slider-cell" @click.stop>
          <span class="ind-icon">{{ ind.icon }}</span>
          <span class="ind-label-s">{{ ind.label }}</span>
          <input type="range" min="0.8" max="1.2" step="0.05" :value="getConf(ind.key)"
            class="conf-slider"
            @input="onConfidenceSliderInput(ind.key, $event.target.value)" />
          <span class="conf-pct">{{ (getConf(ind.key) * 100).toFixed(0) }}%</span>
        </div>
      </div>
    </div>

    <!-- ===== 下半：时间滑块 ===== -->
    <div class="time-section">
      <div class="time-header">
        <span class="time-label">{{ displayTime }}</span>
        <label class="gr-toggle"><input type="checkbox" v-model="isYearMode" />年</label>
      </div>
      <div class="time-slider-wrap">
        <input type="range" :min="0" :max="maxSteps" :value="currentStep" @input="onSlider" class="t-slider" />
        <div class="t-ticks">
          <span v-for="m in YEAR_MARKS" :key="m.year" class="t-tick clickable"
            :style="{ left: yearMarkPosition(m.year) + ''%'' }"
            @click="jumpToYear(m.year)">{{ m.label }}</span>
        </div>
      </div>
      <div class="time-acts">
        <button @click="togglePlay" class="act-btn">{{ forecastState.isPlaying ? ''⏸'' : ''▶'' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.forecast-ctrl { width:100%; height:100%; display:flex; flex-direction:column; padding:10px; box-sizing:border-box; gap:10px; }

/* ===== 按钮网格 ===== */
.btn-grid { display:grid; grid-template-columns:1fr 1fr; grid-template-rows:1fr 1fr; gap:8px; flex:1; min-height:0; }
.btn-cell { border-radius:12px; transition:all .2s; }
.btn-cell.sel { background:#e6f4ff; border:1px solid #409eff; }
.btn-cell.ing { background:#409eff; border:1px solid #409eff; }

.ind-btn { width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px;
  border:1px solid #e0e0e0; border-radius:12px; background:#fff; cursor:pointer; padding:6px 4px; box-sizing:border-box; color:#333; }
.ind-btn:hover { border-color:#409eff; background:#f0f7ff; }
.ind-btn.ok { border-color:#409eff; }
.ind-icon { font-size:18px; line-height:1; }
.ind-label { font-size:13px; font-weight:500; }
.ind-conf { font-size:10px; color:#409eff; }

/* 置信度滑块 */
.slider-cell { width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; padding:4px 8px; box-sizing:border-box; cursor:default; }
.slider-cell .ind-icon { font-size:16px; }
.slider-cell .ind-label-s { font-size:11px; color:#fff; }
.conf-slider { width:80%; height:4px; -webkit-appearance:none; appearance:none; background:rgba(255,255,255,.4); border-radius:2px; outline:none; cursor:pointer; }
.conf-slider::-webkit-slider-thumb { -webkit-appearance:none; width:14px; height:14px; border-radius:50%; background:#fff; cursor:pointer; }
.conf-slider::-moz-range-thumb { width:14px; height:14px; border-radius:50%; background:#fff; cursor:pointer; border:none; }
.conf-pct { font-size:10px; color:#fff; font-weight:600; }

/* ===== 时间滑块 ===== */
.time-section { flex-shrink:0; display:flex; flex-direction:column; gap:6px; }
.time-header { display:flex; align-items:center; justify-content:space-between; }
.time-label { font-size:14px; font-weight:600; color:#409eff; }
.gr-toggle { display:flex; align-items:center; gap:3px; font-size:12px; color:#666; cursor:pointer; }
.gr-toggle input { cursor:pointer; }

.time-slider-wrap { position:relative; padding-bottom:20px; }
.t-slider { width:100%; height:6px; -webkit-appearance:none; appearance:none;
  background:linear-gradient(to right,#e0e0e0,#409eff); border-radius:3px; outline:none; cursor:pointer; }
.t-slider::-webkit-slider-thumb { -webkit-appearance:none; width:18px; height:18px; border-radius:50%;
  background:#409eff; cursor:pointer; border:2px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,.2); }
.t-slider::-moz-range-thumb { width:18px; height:18px; border-radius:50%;
  background:#409eff; cursor:pointer; border:2px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,.2); }

.t-ticks { position:absolute; bottom:0; left:0; right:0; height:18px; }
.t-tick { position:absolute; transform:translateX(-50%); font-size:11px; color:#999; white-space:nowrap; }
.t-tick.clickable { color:#409eff; font-weight:500; cursor:pointer; }
.t-tick.clickable:hover { color:#66b1ff; text-decoration:underline; }

.time-acts { display:flex; justify-content:center; }
.act-btn { padding:4px 14px; background:#f5f5f5; border:1px solid #ddd; border-radius:6px; font-size:14px; cursor:pointer; color:#333; }
.act-btn:hover { background:#e8e8e8; }
</style>
```

## src/business/forecast/composables/useForecastLayer.js

```javascript
import { computed, watch, nextTick } from 'vue''
import { ElMessage } from ''element-plus''
import { useForecastState } from ''@/stores/forecastState''
import { useBusinessLayers } from ''@/core/map/composables/useBusinessLayers''
import { useForecastRequest } from ''./useForecastRequest''
import { useMapStore } from ''@/stores/map''

const INDICATORS = [''throughput'', ''berth'', ''traffic'', ''pressure'']
const INDICATOR_LABELS = {
  throughput: ''吞吐量热力'',
  berth: ''泊位分布'',
  traffic: ''船舶流量'',
  pressure: ''物流压力'',
}
const LAYER_TYPES = {
  throughput: ''heatmap'',
  berth: ''geojson'',
  traffic: ''geojson'',
  pressure: ''geojson'',
}
const FEATURE_TYPES = {
  berth: ''forecast-berth'',
  traffic: ''forecast-traffic'',
  pressure: ''forecast-pressure'',
}

export function useForecastLayer() {
  const forecastState = useForecastState()
  const mapStore = useMapStore()
  const { manager } = useBusinessLayers()
  const { forecastApiRequest } = useForecastRequest()

  const renderer = computed(() => mapStore.currentRenderer)

  // 合并 watch：同时监听 renderer 和 activeIndicator，确保图层状态同步
  watch(
    [() => renderer.value, () => forecastState.activeIndicator],
    async ([r, newInd], [_oldR, oldInd]) => {
      if (!r) return
      
      // P0-1a: 等待 nextTick 确保渲染器完全初始化
      await nextTick()
      
      // 渲染器就绪时注册全部 4 个图层
      for (const indicator of INDICATORS) {
        const key = `forecast-${indicator}`
        if (manager.has(key)) continue
        const isActive = indicator === newInd
        manager.register(key, {
          label: INDICATOR_LABELS[indicator],
          layerType: LAYER_TYPES[indicator],
          data: null,
          options: getLayerOptions(indicator),
          visible: isActive,
        })
      }
      
      // 指标切换时更新图层可见性
      if (oldInd && oldInd !== newInd) {
        const oldKey = `forecast-${oldInd}`
        if (manager.has(oldKey)) manager.setVisible(oldKey, false)
      }
      const newKey = `forecast-${newInd}`
      if (manager.has(newKey)) manager.setVisible(newKey, true)
    },
    { immediate: true },
  )

  function getLayerOptions(indicator) {
    if (indicator === ''throughput'') {
      return { weightField: ''value'', radius: 20, blur: 15 }
    }
    const ft = FEATURE_TYPES[indicator]
    return ft ? { featureType: ft } : {}
  }

  function getRenderData(layerType, geojson) {
    if (layerType === ''heatmap'') return geojson.features || []
    return geojson
  }

  async function updateForecastLayer(transactionId, signal) {
    const r = renderer.value
    if (!r) return

    const indicator = forecastState.activeIndicator
    const rawTime = forecastState.currentTime
    const time = rawTime.includes(''-'') ? rawTime : `${rawTime}-12`
    const key = `forecast-${indicator}`

    try {
      // P0-1b: 检查图层是否存在，若不存在则重新注册
      if (!manager.has(key)) {
        await nextTick()
        if (!manager.has(key)) {
          manager.register(key, {
            label: INDICATOR_LABELS[indicator],
            layerType: LAYER_TYPES[indicator],
            data: null,
            options: getLayerOptions(indicator),
            visible: true,
          })
        }
      }

      const confidence = forecastState.confidenceThresholds[indicator] || 0.8
      const response = await forecastApiRequest(
        `/forecast/map?indicator=${indicator}&time=${time}&confidence=${confidence}`,
        transactionId,
        signal
      )

      // 事务过期或请求被取消
      if (response === null) return
      if (response.code !== 200 || !response.data) return

      const geojson = response.data
      const layerType = LAYER_TYPES[indicator]
      const data = getRenderData(layerType, geojson)
      const options = getLayerOptions(indicator)

      manager.updateData(key, { data, options })
    } catch (e) {
      if (import.meta.env.DEV) console.error(''[useForecastLayer] 更新失败:'', e)
      ElMessage.error(''更新地图图层失败'')
    }
  }

  function removeForecastLayer() {
    for (const indicator of INDICATORS) {
      const key = `forecast-${indicator}`
      if (manager.has(key)) manager.remove(key)
    }
  }

  return { updateForecastLayer, removeForecastLayer, renderer }
}
```

## src/business/forecast/composables/useForecastRequest.js

```javascript
import { ref } from 'vue''

const API_BASE = import.meta.env.VITE_API_BASE || ''/api''

// ==================== 模块级单例状态 ====================
let currentTransactionId = 0
let currentAbortController = null
const isLoading = ref(false)

/**
 * 开始新事务
 * 调用时机：状态变化前（indicator/time/confidence 改变前）
 * 效果：取消旧事务，生成新事务 ID
 */
function startTransaction() {
  // 取消旧事务
  if (currentAbortController) {
    currentAbortController.abort()
  }
  
  // 生成新事务 ID
  currentTransactionId++
  currentAbortController = new AbortController()
  
  return {
    transactionId: currentTransactionId,
    signal: currentAbortController.signal,
  }
}

/**
 * 检查事务是否仍然有效
 * @param {number} transactionId - 要检查的事务 ID
 * @returns {boolean} - 是否有效
 */
function isTransactionValid(transactionId) {
  return transactionId === currentTransactionId
}

/**
 * 执行预测 API 请求（直接使用 fetch，支持真正的 AbortController）
 * @param {string} path - API 路径
 * @param {number} transactionId - 事务 ID
 * @param {AbortSignal} signal - 取消信号
 * @returns {Promise} - API 响应
 */
async function forecastApiRequest(path, transactionId, signal) {
  // 如果事务已过期，直接返回 null
  if (!isTransactionValid(transactionId)) {
    return null
  }
  
  try {
    isLoading.value = true
    
    // 直接使用 fetch，传入 signal 实现真正的请求取消
    const res = await fetch(`${API_BASE}${path}`, {
      method: ''GET'',
      headers: {
        ''Content-Type'': ''application/json'',
      },
      credentials: ''include'',
      signal, // 传入外部的 AbortSignal
    })
    
    const data = await res.json().catch(() => ({}))
    
    // 再次检查事务是否仍然有效（可能在 await 期间被取消）
    if (!isTransactionValid(transactionId)) {
      return null
    }
    
    // 处理 401 未授权
    if (res.status === 401) {
      const router = (await import(''@/router'')).default
      if (router.currentRoute.value.path !== ''/'') {
        router.push(''/'')
      }
      throw new Error(''登录已过期，请重新登录'')
    }
    
    // 处理其他错误
    if (!res.ok) {
      throw new Error(data.error || `请求失败 HTTP ${res.status}`)
    }
    
    return data
  } catch (error) {
    // 如果是取消错误，返回 null
    if (error.name === ''AbortError'') {
      return null
    }
    
    // 其他错误向上抛出
    throw error
  } finally {
    // 只有当事务仍然有效时才更新 loading 状态
    if (isTransactionValid(transactionId)) {
      isLoading.value = false
    }
  }
}

/**
 * 获取当前事务信息
 * 用于需要共享事务 ID 的场景（如一次预测任务的三个请求）
 */
function getCurrentTransaction() {
  return {
    transactionId: currentTransactionId,
    signal: currentAbortController?.signal,
  }
}

/**
 * 取消所有请求
 * 用于组件卸载等场景
 */
function cancelAll() {
  if (currentAbortController) {
    currentAbortController.abort()
  }
  currentTransactionId = 0
  currentAbortController = null
  isLoading.value = false
}

/**
 * 导出单例接口
 */
export function useForecastRequest() {
  return {
    isLoading,
    startTransaction,
    isTransactionValid,
    forecastApiRequest,
    getCurrentTransaction,
    cancelAll,
  }
}
```

## 业务模块 - 浸没分析

## src/business/flood-analysis/FloodAnalysisPage.vue

```vue
<script setup>
// 浸没分析页面：4面板布局(左上报告/左下设施/右上剖面/右下水��)，Cesium引擎
import { onMounted, onUnmounted, watch, nextTick } from 'vue''
import { onBeforeRouteLeave, useRoute } from ''vue-router''
import { ElMessage } from ''element-plus''
import { useFloodStateStore } from ''@/stores/floodState''
import AppLayout from ''@/core/layout/AppLayout.vue''
import GcsPanel from ''@/core/layout/components/GcsPanel.vue''
import { useGcsStore } from ''@/stores/gcsStore''
import { useWaterLevelStore } from ''@/stores/waterLevelStore''
import { useFloodStore } from ''@/stores/floodStore''
import { usePortImpactStore } from ''@/stores/portImpactStore''
import { useMapStore } from ''@/stores/map''
import { useBusinessLayers } from ''@/core/map/composables/useBusinessLayers''
import { useApiRequest } from ''@/shared/composables/useApiRequest''
import WaterLevelProfilePanel from ''./components/WaterLevelProfilePanel.vue''
import FloodAnalysisReportPanel from ''./components/FloodAnalysisReportPanel.vue''
import AffectedFacilityListPanel from ''./components/AffectedFacilityListPanel.vue''
import LayerControlPanel from ''@/shared/components/LayerControlPanel.vue''
import { logger } from ''@/shared/utils/logger''

const { apiRequest } = useApiRequest()
const gcsStore = useGcsStore()
const waterLevelStore = useWaterLevelStore()
const floodStore = useFloodStore()
const portImpactStore = usePortImpactStore()
const mapStore = useMapStore()
const { manager: businessLayerManager } = useBusinessLayers()

const floodStateStore = useFloodStateStore()

const route = useRoute()

function shouldRenderForCurrentRoute() {
  const expected = route.meta?.engine
  const actual = mapStore.currentRenderer?.getType?.()
  if (!expected || !actual) return false
  return expected === actual
}

/** 状态恢复标志：恢复状态时禁止 watch 触发重复 API 请求 */
let stateRestored = false

/** 防抖定时器 */
let analysisTimer = null

// 请求序号，仅最新响应写 store；防止切回2D后数据污染渲染器
let analysisSeq = 0
let unmounted = false

// P1-9-flood: 为浸没分析请求维护 AbortController，支持取消旧请求
let floodAnalysisController = null
let impactAssessmentController = null

const ANALYSIS_DELAY = 500

const WATER_SURFACE_ID = ''gcs-water-surface''

const FLOOD_LAYER_ID = ''gcs-flood-area''
const FACILITY_LAYER_ID = ''gcs-facilities''

// FIX:P3-02: 钦州港附近水面坐标兜底，实际�� water-area.json 加载
const FALLBACK_WATER_AREA_COORDINATES = [
  [108.615, 21.855],
  [108.62, 21.855],
  [108.622, 21.858],
  [108.621, 21.862],
  [108.618, 21.863],
  [108.614, 21.861],
  [108.615, 21.855],
]

let cachedWaterAreaCoords = null

async function loadWaterAreaCoordinates() {
  if (cachedWaterAreaCoords) return cachedWaterAreaCoords
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(''/data/water-area.json'', { signal: controller.signal })
    clearTimeout(timeoutId)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    cachedWaterAreaCoords = data.coordinates
    return cachedWaterAreaCoords
  } catch {
    if (import.meta.env.DEV) {
      console.warn(''[GCS] water-area.json 加载失败，使用兜底坐标'')
    }
    return FALLBACK_WATER_AREA_COORDINATES
  }
}

/** 图层是否已注册（防止重复注册） */
let gcsLayersRegistered = false

// 注册业务图层到 BusinessLayerManager
// 首次 register 只建 catalog 条目，不渲染（数据尚未就绪）
// API 返回数据后通过 updateData 渲染
async function registerGcsLayers() {
  if (gcsLayersRegistered) return

  const waterCoords = await loadWaterAreaCoordinates()
  if (unmounted) return

  gcsLayersRegistered = true

  // 水面图层
  businessLayerManager.register(WATER_SURFACE_ID, {
    label: ''水面'',
    layerType: ''waterSurface'',
    data: { coordinates: waterCoords, height: waterLevelStore.waterLevel },
    options: { color: ''rgba(64, 158, 255, 0.5)'' },
    visible: true,
  })

  // 淹没范围图层（无初始数据，等待 API 返回）
  businessLayerManager.register(FLOOD_LAYER_ID, {
    label: ''淹没范围'',
    layerType: ''geojson'',
    data: null,
    options: {},
    visible: true,
  })

  // 受影响设施图层（无初始数据，等待 API 返回）
  businessLayerManager.register(FACILITY_LAYER_ID, {
    label: ''受影响设施'',
    layerType: ''points'',
    data: null,
    options: {},
    visible: true,
  })
}

// 渲染器就绪时自动注册图层到控制面板
watch(
  () => mapStore.currentRenderer,
  (renderer) => {
    if (renderer) {
      nextTick(() => {
        registerGcsLayers()
      })
    }
  },
  { immediate: true },
)

onBeforeRouteLeave((to) => {
  if (to.path === ''/profile'') {
    saveCurrentState()
  } else {
    floodStateStore.clearState()
  }
})

function saveCurrentState() {
  floodStateStore.saveState({
    waterLevel: waterLevelStore.waterLevel,
    floodStatistics: floodStore.floodStatistics,
    floodFeatures: floodStore.floodFeatures,
    floodRiskLevel: floodStore.floodRiskLevel,
    affectedFacilities: portImpactStore.affectedFacilities,
    totalLoss: portImpactStore.totalLoss,
  })
}

/**
 * 挂载时恢复保存的状态
 */
onMounted(() => {
  const savedState = floodStateStore.consumeState()
  if (savedState) {
    // 清除 {immediate: true} watch 已排入的防抖分析，避免恢复后覆盖
    if (analysisTimer) {
      clearTimeout(analysisTimer)
      analysisTimer = null
    }

    stateRestored = true

    waterLevelStore.setWaterLevel(savedState.waterLevel)

    if (savedState.floodStatistics) {
      floodStore.startFloodAnalysis(
        savedState.floodStatistics,
        savedState.floodFeatures,
        savedState.floodRiskLevel,
      )
    }

    if (savedState.affectedFacilities) {
      portImpactStore.setPortImpactResult(savedState.affectedFacilities, savedState.totalLoss)
    }

    stateRestored = false

    // P1-6: 状态恢复后主动调用渲染函数，确保地图图层正确更新
    nextTick(() => {
      if (shouldRenderForCurrentRoute()) {
        if (savedState.floodFeatures && savedState.floodFeatures.length > 0) {
          renderFloodAreas(savedState.floodFeatures)
        }
        if (savedState.affectedFacilities && savedState.affectedFacilities.length > 0) {
          renderAffectedFacilities(savedState.affectedFacilities)
        }
      }
    })
  }
})

// 水位变化防抖500ms后自动触发淹没问题分析和影响评估
watch(
  () => waterLevelStore.waterLevel,
  (newLevel) => {
    if (stateRestored) return

    if (analysisTimer) {
      clearTimeout(analysisTimer)
    }

    analysisTimer = setTimeout(() => {
      // P1-9-flood: 取消旧的请求
      if (floodAnalysisController) floodAnalysisController.abort()
      if (impactAssessmentController) impactAssessmentController.abort()

      // FIX:P2-02: 递增的请求序号
      const seq = ++analysisSeq
      logger.debug(''[GCS] 防抖结束，触发分析，水位:'', newLevel, ''seq:'', seq)
      triggerFloodAnalysis(newLevel, seq)
      triggerImpactAssessment(newLevel, seq)
    }, ANALYSIS_DELAY)
  },
  { immediate: true },
)

async function triggerFloodAnalysis(waterLevel, seq) {
  try {
    logger.debug(''[GCS] 触发淹没分析，水位:'', waterLevel, ''seq:'', seq)

    // P1-9-flood: 创建新的 AbortController
    floodAnalysisController = new AbortController()
    const signal = floodAnalysisController.signal

    // 并行请求淹没范围和统计数据，共享同一 signal
    const [floodAreasData, statisticsData] = await Promise.all([
      apiRequest(`/gcs/flood-areas?waterLevel=${waterLevel}`, { signal }),
      apiRequest(`/gcs/flood-statistics?waterLevel=${waterLevel}`, { signal }),
    ])

    logger.debug(''[GCS] 淹没分析响应:'', { floodAreasData, statisticsData })

    if (floodAreasData.code === 200 && statisticsData.code === 200) {
      // FIX:P2-02: 已有更新请求，丢弃过期响应
      if (seq !== analysisSeq) return
      // 如果当前路由不再是 3D，丢弃过期响应防止污染 2D 渲染器
      if (!shouldRenderForCurrentRoute()) return
      // FIX:P2-07: 实际档位与请求不一致时提示，��义透明
      if (
        floodAreasData.data.actualWaterLevel !== undefined &&
        floodAreasData.data.actualWaterLevel !== waterLevel
      ) {
        logger.info(
          `[GCS] 请求水位 ${waterLevel}m，实际使用数据档位 ${floodAreasData.data.actualWaterLevel}m`,
        )
      }
      const features = floodAreasData.data.features || []
      const statistics = statisticsData.data
      const riskLevel = floodAreasData.data.riskLevel || ''无风险''

      logger.debug(''[GCS] 更新淹没分析数据:'', { statistics, features: features.length, riskLevel })

      floodStore.startFloodAnalysis(statistics, features, riskLevel)

      // 在地图上渲染淹没范围
      renderFloodAreas(features)
    } else {
      console.warn(''[GCS] 淹没分析响应异常:'', { floodAreasData, statisticsData })
    }
  } catch (error) {
    ElMessage.error(''淹没分析失败，请检查网络连接'')
    console.error(''[GCS] 淹没分析失败:'', error)
  }
}

async function triggerImpactAssessment(waterLevel, seq) {
  try {
    logger.debug(''[GCS] 触发影响评估，水位:'', waterLevel, ''seq:'', seq)

    // P1-9-flood: 创建新的 AbortController
    impactAssessmentController = new AbortController()
    const signal = impactAssessmentController.signal

    // 调用灾害评估接口
    const data = await apiRequest(''/gcs/analysis/disaster'', {
      method: ''POST'',
      body: JSON.stringify({ waterLevel }),
      signal,
    })
    logger.debug(''[GCS] 影响评估响应:'', data)

    if (data.code === 200) {
      // FIX:P2-02: 已有更新请求，丢弃过期响应
      if (seq !== analysisSeq) return
      // 如果当前路由不再是 3D，丢弃过期响应防止污染 2D 渲染器
      if (!shouldRenderForCurrentRoute()) return
      const result = data.data
      const facilities = result.affectedFacilities || []
      const totalLoss = result.totalLoss || 0

      logger.debug(''[GCS] 更新影响评估数据:'', { facilities: facilities.length, totalLoss })

      portImpactStore.setPortImpactResult(facilities, totalLoss)

      // 在地图上渲染受影响设施
      renderAffectedFacilities(facilities)
    } else {
      console.warn(''[GCS] 影响评估响应异常:'', data)
    }
  } catch (error) {
    ElMessage.error(''影响评估失败，请检查网络连接'')
    console.error(''[GCS] 影响评估失败:'', error)
  }
}

async function renderFloodAreas(features) {
  if (!features || features.length === 0) return

  // P1-7a: 检查图层是否存在，若不存在则先注册
  if (!businessLayerManager.has(FLOOD_LAYER_ID)) {
    await registerGcsLayers()
    // 重试检查
    if (!businessLayerManager.has(FLOOD_LAYER_ID)) {
      console.warn(''[GCS] 淹没范围图层注册失败'')
      return
    }
  }

  const riskLevel = floodStore.floodRiskLevel
  const fillColor = getRiskFillColor(riskLevel)
  const strokeColor = getRiskColor(riskLevel)

  const geojson = {
    type: ''FeatureCollection'',
    features: features,
  }

  businessLayerManager.updateData(FLOOD_LAYER_ID, {
    data: geojson,
    options: {
      fillColor,
      strokeColor,
      strokeWidth: 2,
      featureType: ''flood-area'',
    },
  })
}

async function renderAffectedFacilities(facilities) {
  if (!facilities || facilities.length === 0) return

  // P1-7a: 检查图层是否存在，若不存在则先注册
  if (!businessLayerManager.has(FACILITY_LAYER_ID)) {
    await registerGcsLayers()
    // 重试检查
    if (!businessLayerManager.has(FACILITY_LAYER_ID)) {
      console.warn(''[GCS] 受影响设施图层注册失败'')
      return
    }
  }

  const geojson = {
    type: ''FeatureCollection'',
    features: facilities.map((f) => ({
      type: ''Feature'',
      geometry: {
        type: ''Point'',
        coordinates: [f.longitude || 0, f.latitude || 0],
      },
      properties: {
        id: f.id,
        name: f.name,
        type: f.type,
        port: f.port,
        loss: f.loss,
        damageRate: f.damageRate,
      },
    })),
  }

  businessLayerManager.updateData(FACILITY_LAYER_ID, {
    data: geojson,
    options: {
      markerColor: ''#F56C6C'',
      markerSize: 10,
      featureType: ''facility-point'',
    },
  })
}

function getRiskColor(riskLevel) {
  const colorMap = {
    无风险: ''#909399'',
    低风险: ''#67C23A'',
    中风险: ''#E6A23C'',
    高风险: ''#F56C6C'',
    极高风险: ''#F56C6C'',
    灾难级: ''#F56C6C'',
  }
  return colorMap[riskLevel] || ''#909399''
}

function getRiskFillColor(riskLevel) {
  const colorMap = {
    无风险: ''rgba(144, 147, 153, 0.3)'',
    低风险: ''rgba(103, 194, 58, 0.3)'',
    中风险: ''rgba(230, 162, 60, 0.3)'',
    高风险: ''rgba(245, 108, 108, 0.3)'',
    极高风险: ''rgba(245, 108, 108, 0.4)'',
    灾难级: ''rgba(245, 108, 108, 0.5)'',
  }
  return colorMap[riskLevel] || ''rgba(144, 147, 153, 0.3)''
}

// 水位变化时更新水面高度
watch(
  () => waterLevelStore.waterLevel,
  (newLevel) => {
    if (!businessLayerManager.has(WATER_SURFACE_ID)) return
    businessLayerManager.updateData(WATER_SURFACE_ID, {
      data: { coordinates: cachedWaterAreaCoords || FALLBACK_WATER_AREA_COORDINATES, height: newLevel },
    })
  },
)

onUnmounted(() => {
  unmounted = true

  // 清除防抖分析定时器
  if (analysisTimer) {
    clearTimeout(analysisTimer)
    analysisTimer = null
  }

  // P1-9-flood: 取消未完成的请求
  if (floodAnalysisController) {
    floodAnalysisController.abort()
    floodAnalysisController = null
  }
  if (impactAssessmentController) {
    impactAssessmentController.abort()
    impactAssessmentController = null
  }

  // Manager 统一清理业务图层
  businessLayerManager.remove(WATER_SURFACE_ID)
  businessLayerManager.remove(FLOOD_LAYER_ID)
  businessLayerManager.remove(FACILITY_LAYER_ID)

  // 重置注册标志
  gcsLayersRegistered = false

  gcsStore.resetAll()
})
</script>

<template>
  <!-- FIX:P2-01: 类名与样式表统一 -->
  <div class="flood-analysis-page">
    <AppLayout>
      <template #left>
        <GcsPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
          <FloodAnalysisReportPanel />
        </GcsPanel>

        <GcsPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="5.5">
          <AffectedFacilityListPanel />
        </GcsPanel>
      </template>

      <template #right>
        <GcsPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <WaterLevelProfilePanel />
        </GcsPanel>

        <GcsPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
          <LayerControlPanel />
        </GcsPanel>
      </template>
    </AppLayout>
  </div>
</template>

<style scoped>
.flood-analysis-page {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  /* 让鼠标事件穿透到下层地图，面板通过 :deep(.gcs-panel) 恢复 */
  pointer-events: none;
}

/* 仅面板恢复鼠标事件 */
.flood-analysis-page :deep(.gcs-panel) {
  pointer-events: auto;
}

.panel-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
  border: 1px dashed rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.6);
}

.placeholder-title {
  font-size: 16px;
  font-weight: 500;
  margin-bottom: 8px;
}

.placeholder-desc {
  font-size: 13px;
  opacity: 0.7;
}

/* Cesium 3D路由禁用backdrop-filter，避免WebGL性能问题 */
.flood-analysis-page :deep(.gcs-panel) {
  backdrop-filter: none !important;
  background: rgba(255, 255, 255, 0.95) !important;
}
</style>
```

## src/business/flood-analysis/components/AffectedFacilityListPanel.vue

```vue
<script setup>
/**
 * AffectedFacilityListPanel - 受影响设施清单面板（浸没分析专用）
 *
 * 功能：
 * 1. 显示受影响设施清单，按损失金额排名
 * 2. 分页显示，每页4个设施
 * 3. 收藏功能对接usePlans，与选址分析共用保存小区接口
 *
 * 布局：4×4 Cell
 * 位置：左下（bottom-left）
 */

import { computed } from 'vue''
import { usePortImpactStore } from ''@/stores/portImpactStore''
import PaginatedListPanel from ''@/shared/components/PaginatedListPanel.vue''

const portImpactStore = usePortImpactStore()

/**
 * 获取设施类型对应的中文标签
 */
function getFacilityTypeLabel(type) {
  const typeMap = {
    泊位: ''泊位'',
    码头: ''码头'',
    仓储区: ''仓储'',
    油库: ''油库'',
  }
  return typeMap[type] || type
}

/**
 * 格式化损失金额
 */
function formatLoss(loss) {
  // FIX:P3-15: 非法输入防御
  const v = Number(loss)
  if (!isFinite(v)) return ''—''
  if (v >= 10000) {
    return (v / 10000).toFixed(1) + ''万''
  }
  return v.toFixed(0)
}

/**
 * 按损失金额排序的设施列表（降序）
 */
const sortedFacilities = computed(() => {
  const facilities = portImpactStore.affectedFacilities || []
  return [...facilities].sort((a, b) => b.loss - a.loss)
})
</script>

<template>
  <PaginatedListPanel
    :items="sortedFacilities"
    :page-size="4"
    title="受影响设施清单"
    empty-text="暂无受影响设施"
    empty-hint="开始评估后显示设施清单"
    plan-type="flood"
  >
    <template #item="{ item: facility }">
      <div class="facility-info">
        <span class="facility-name">{{ facility.name }}</span>
        <span class="facility-type">{{ getFacilityTypeLabel(facility.type) }}</span>
      </div>
      <span class="facility-loss">{{ formatLoss(facility.loss) }}元</span>
    </template>
  </PaginatedListPanel>
</template>

<style scoped>
.facility-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  justify-content: center;
}

.facility-name {
  color: #303133;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
  flex: 1;
}

.facility-type {
  color: #909399;
  font-size: 12px;
  flex-shrink: 0;
}

.facility-loss {
  color: #f56c6c;
  font-weight: 600;
  flex-shrink: 0;
  min-width: 70px;
  text-align: right;
}
</style>
```

## src/business/flood-analysis/components/FloodAnalysisReportPanel.vue

```vue
<script setup>
/**
 * FloodAnalysisReportPanel - 浸没分析报告面板
 *
 * 功能：
 * 1. 显示浸没分析关键信息（淹没面积、水深、损失等）
 * 2. 自动响应水位变化，实时更新数据
 * 3. 灰色区域：3.8宽×2.8高，距标题下方0.6cell、左右各0.1cell
 *
 * 布局：4×4 Cell，左上位置
 */

import { computed } from 'vue''
import { useFloodStore } from ''@/stores/floodStore''
import { usePortImpactStore } from ''@/stores/portImpactStore''
import { useWaterLevelStore } from ''@/stores/waterLevelStore''
import { useGCS } from ''@/core/layout/useGCS.js''

const floodStore = useFloodStore()
const portImpactStore = usePortImpactStore()
const waterLevelStore = useWaterLevelStore()
const { cellPixel, css } = useGCS()
// 解构出 CSS 变量供 v-bind() 使用
const { cell8px, cell16px, cell40px } = css

/**
 * 计算灰色内容区样式（基于cell单位，响应式布局）
 * 尺寸：3.8宽 × 2.8高（cell单位）
 * 位置：距面板顶部0.6cell、左右各0.1cell
 * 使用绝对定位，相对于.flood-analysis-report-panel
 */
const contentStyle = computed(() => {
  const cell = cellPixel.value

  return {
    width: `${3.8 * cell}px`,
    height: `${2.8 * cell}px`,
    top: `${0.6 * cell}px`,
    left: `${0.1 * cell}px`,
  }
})

/** 格式化损失金额 */
function formatLoss(loss) {
  if (loss >= 10000) {
    return (loss / 10000).toFixed(1) + '' 亿''
  }
  return loss.toFixed(0) + '' 万''
}

/** 影响等级（根据总损失计算） */
const impactLevel = computed(() => {
  const loss = portImpactStore.totalLoss
  if (loss === 0) return ''无''
  if (loss < 10000) return ''低''
  if (loss < 50000) return ''中''
  if (loss < 100000) return ''高''
  return ''极高''
})

/** 始终显示报告内容 */
const showReport = computed(() => true)
</script>

<template>
  <div class="flood-analysis-report-panel">
    <!-- 标题区 -->
    <div class="panel-header">
      <div class="header-title">浸没分析报告</div>
    </div>

    <!-- 灰色内容区：3.8宽×2.8高，距标题下方0.6cell、左右各0.1cell -->
    <div class="report-content" v-if="showReport" :style="contentStyle">
      <div class="info-item" v-if="floodStore.floodStatistics">
        <span class="info-label">淹没面积</span>
        <span class="info-value">{{ floodStore.floodStatistics.floodArea || 0 }} km²</span>
      </div>
      <div class="info-item" v-if="floodStore.floodStatistics">
        <span class="info-label">平均水深</span>
        <span class="info-value">{{ floodStore.floodStatistics.averageDepth || 0 }} m</span>
      </div>
      <div class="info-item" v-if="floodStore.floodStatistics">
        <span class="info-label">最大水深</span>
        <span class="info-value">{{ floodStore.floodStatistics.maxDepth || 0 }} m</span>
      </div>
      <div class="info-item">
        <span class="info-label">受影响设施</span>
        <span class="info-value"
          >{{
            portImpactStore.affectedFacilities.length || floodStore.floodStatistics?.affectedFacilities || 0
          }}
          个</span
        >
      </div>
      <div class="info-item">
        <span class="info-label">预估损失</span>
        <span class="info-value highlight"
          >{{
            formatLoss(portImpactStore.totalLoss || floodStore.floodStatistics?.estimatedLoss || 0)
          }}元</span
        >
      </div>
      <div class="info-item">
        <span class="info-label">影响等级</span>
        <span class="info-value">{{ impactLevel }}</span>
      </div>
      <div class="info-item" v-if="floodStore.floodStatistics?.affectedPorts?.length > 0">
        <span class="info-label">受影响港口</span>
        <span class="info-value">{{ floodStore.floodStatistics.affectedPorts.join(''、'') }}</span>
      </div>
    </div>

    <!-- 无数据提示 -->
    <div class="no-data-section" v-else>
      <div class="no-data-text">当前水位：{{ waterLevelStore.waterLevel.toFixed(1) }} m</div>
      <div class="no-data-hint">开始分析后显示浸没报告</div>
    </div>
  </div>
</template>

<style scoped>
.flood-analysis-report-panel {
  width: 100%;
  height: 100%;
  padding: 0;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 8px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* 标题区：居中显示 */
.panel-header {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: v-bind(cell16px);
  flex-shrink: 0;
}

.header-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

/*
 * 灰色内容区（绝对定位，从面板顶部算起）
 * 尺寸：3.8宽 × 2.8高（cell单位，响应式）
 * 位置：距面板顶部0.6cell、左右各0.1cell
 * 内容区域在灰色面板内上下左右居中
 */
.report-content {
  position: absolute;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
  border-radius: 6px;
  box-sizing: border-box;
  /* 内容区域在灰色面板内居中 */
  justify-content: center;
  align-items: center;
  padding: v-bind(cell16px);
}

/* 信息列表容器：占满灰色面板，info-item左右对齐 */
.info-list {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 信息行：左右对齐，占满灰色面板宽度 */
.info-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  width: 100%;
}

.info-label {
  color: #606266;
}

.info-value {
  color: #303133;
  font-weight: 500;
}

.info-value.highlight {
  color: #f56c6c;
  font-weight: 600;
}

/* 无数据提示 */
.no-data-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: v-bind(cell40px) 20px;
  gap: v-bind(cell8px);
  flex: 1;
}

.no-data-text {
  font-size: 14px;
  color: #303133;
  font-weight: 500;
}

.no-data-hint {
  font-size: 12px;
  color: #909399;
}
</style>
```

## src/business/flood-analysis/components/WaterLevelProfilePanel.vue

```vue
<script setup>
/**
 * WaterLevelProfilePanel - 水位滑块与剖面分析控制面板
 *
 * 功能：
 * 1. 水位滑块控制（0-10m，0.1步长）
 * 2. 可点击刻度标记（平均海平面/设计高潮位/极端最高水位）
 * 3. 下拉选择4条预设剖面线
 * 4. 自动显示ECharts高程剖面图
 * 5. 叠加当前水位线（随水位变化自动更新）
 *
 * 布局：4×4 Cell
 * 位置：右上（top-right）
 */

import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useWaterLevelStore } from '@/stores/waterLevelStore'
import { useProfileStore } from ''@/stores/profileStore''
import { useGCS } from ''@/core/layout/useGCS.js''
import { useApiRequest } from ''@/shared/composables/useApiRequest''
import { ElSelect, ElOption, ElMessage, ElSlider } from ''element-plus''
import * as echarts from ''echarts/core''
import { LineChart } from ''echarts/charts''
import { GridComponent, TitleComponent, LegendComponent, TooltipComponent } from ''echarts/components''
import { CanvasRenderer } from ''echarts/renderers''

echarts.use([LineChart, GridComponent, TitleComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const { apiRequest } = useApiRequest()
const waterLevelStore = useWaterLevelStore()
const profileStore = useProfileStore()
// 直接从 useGCS 解构 CSS 变量供 v-bind() 使用
const { cell8px, cell16px } = useGCS()

const localWaterLevel = ref(waterLevelStore.waterLevel)

/**
 * 可点击刻度标记配置
 */
const scaleMarks = [
  { label: ''平均海平面'', value: 2.5 },
  { label: ''设计高潮位'', value: 4.5 },
  { label: ''极端最高水位'', value: 6.8 },
]

/**
 * 监听Store水位变化，同步到本地
 */
watch(
  () => waterLevelStore.waterLevel,
  (newLevel) => {
    localWaterLevel.value = newLevel
  },
)

/**
 * Slider值变化处理
 * 用户拖动Slider时触发，直接更新Store
 * 防抖由父组件FloodAnalysisPage统一处理（500ms）
 */
function onSliderChange(value) {
  waterLevelStore.setWaterLevel(value)
}

function setWaterLevelByMark(value) {
  localWaterLevel.value = value
  waterLevelStore.setWaterLevel(value)
}

/** 剖面线列表 */
const profiles = ref([])

/** 当前选中的剖面线ID */
const selectedProfileId = ref(null)

/** ECharts实例 */
let chartInstance = null

/** ECharts容器DOM引用 */
const chartContainerRef = ref(null)

/**
 * 加载剖面线数据
 * 从后端API获取所有预设剖面线
 */
async function loadProfiles() {
  try {
    const result = await apiRequest(''/gcs/terrain-profiles'')

    if (result.code === 200 && result.data) {
      profiles.value = result.data
      // 默认选择第一条剖面线
      if (profiles.value.length > 0) {
        selectedProfileId.value = profiles.value[0].id
        profileStore.setSelectedProfile(profiles.value[0].id)
      }
    } else {
      ElMessage.error(''加载剖面线数据失败'')
    }
  } catch (error) {
    console.error(''加载剖面线失败:'', error)
    ElMessage.error(''加载剖面线数据失败'')
  }
}

/**
 * 获取当前选中的剖面数据
 */
function getCurrentProfile() {
  return profiles.value.find((p) => p.id === selectedProfileId.value)
}

/**
 * 初始化ECharts图表
 */
function initChart() {
  if (!chartContainerRef.value) return

  // 如果已有实例，先销毁
  if (chartInstance) {
    chartInstance.dispose()
  }

  chartInstance = echarts.init(chartContainerRef.value)
}

/**
 * 更新剖面图表
 */
function updateChart() {
  if (!chartInstance) {
    initChart()
  }

  const profile = getCurrentProfile()
  if (!profile) {
    return
  }

  // 提取距离和高程数据
  const distances = profile.points.map((p) => p.distance)
  const elevations = profile.points.map((p) => p.elevation)

  // 获取当前水位
  const waterLevel = waterLevelStore.waterLevel

  // 配置ECharts选项
  const option = {
    tooltip: {
      trigger: ''axis'',
      formatter: (params) => {
        const distance = params[0].axisValue
        let content = `距离: ${distance}m<br/>`
        params.forEach((param) => {
          content += `${param.marker}${param.seriesName}: ${param.value}m<br/>`
        })
        return content
      },
    },
    legend: {
      data: [''地形高程'', ''水位线''],
      top: 0,
      textStyle: {
        fontSize: 12,
      },
    },
    grid: {
      left: ''10%'',
      right: ''10%'',
      bottom: ''10%'',
      top: ''20%'',
    },
    xAxis: {
      type: ''category'',
      data: distances,
      name: ''距离 (m)'',
      nameLocation: ''middle'',
      nameGap: 30,
      nameTextStyle: {
        fontSize: 12,
      },
    },
    yAxis: {
      type: ''value'',
      name: ''高程 (m)'',
      nameTextStyle: {
        fontSize: 12,
      },
    },
    series: [
      {
        name: ''地形高程'',
        type: ''line'',
        data: elevations,
        smooth: true,
        lineStyle: {
          color: ''#67C23A'',
          width: 2,
        },
        itemStyle: {
          color: ''#67C23A'',
        },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: ''rgba(103, 194, 58, 0.3)'' },
            { offset: 1, color: ''rgba(103, 194, 58, 0.05)'' },
          ]),
        },
      },
      {
        name: ''水位线'',
        type: ''line'',
        data: distances.map(() => waterLevel),
        lineStyle: {
          color: ''#409EFF'',
          width: 2,
          type: ''dashed'',
        },
        itemStyle: {
          color: ''#409EFF'',
        },
        symbol: ''none'',
      },
    ],
  }

  // P1-10: 使用增量更新而非全量替换，提升性能
  chartInstance.setOption(option, { notMerge: false, lazyUpdate: true })
}

/**
 * 监听剖面线选择变化
 */
watch(selectedProfileId, (newId) => {
  profileStore.setSelectedProfile(newId)
  updateChart()
})

/**
 * 监听水位变化，更新图表中的水位线
 */
watch(
  () => waterLevelStore.waterLevel,
  () => {
    if (chartInstance && selectedProfileId.value) {
      updateChart()
    }
  },
)

/**
 * 组件挂载时初始化
 */
onMounted(() => {
  loadProfiles()
  initChart()

  // 监听窗口大小变化
  window.addEventListener(''resize'', handleResize)
})

/**
 * 处理窗口大小变化
 */
function handleResize() {
  if (chartInstance) {
    chartInstance.resize()
  }
}

/**
 * 组件卸载时清理
 */
onUnmounted(() => {
  if (chartInstance) {
    chartInstance.dispose()
    chartInstance = null
  }

  window.removeEventListener(''resize'', handleResize)
})
</script>

<template>
  <div class="water-level-profile-panel">
    <!-- 标题区 -->
    <div class="panel-header">
      <div class="header-title">剖面分析</div>
      <ElSelect
        v-model="selectedProfileId"
        placeholder="选择剖面线"
        size="small"
        class="profile-select"
        :teleported="false"
      >
        <ElOption
          v-for="profile in profiles"
          :key="profile.id"
          :label="profile.name"
          :value="profile.id"
        />
      </ElSelect>
    </div>

    <!-- ECharts图表区 -->
    <div ref="chartContainerRef" class="chart-container"></div>

    <!-- 水位滑块区域（紧凑布局） -->
    <div class="water-slider-container">
      <ElSlider
        v-model="localWaterLevel"
        :min="0"
        :max="10"
        :step="0.1"
        :show-tooltip="false"
        @input="onSliderChange"
        @change="onSliderChange"
      />
      <div class="scale-marks">
        <span
          v-for="mark in scaleMarks"
          :key="mark.value"
          class="scale-mark clickable"
          @click="setWaterLevelByMark(mark.value)"
        >
          {{ mark.label }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.water-level-profile-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: v-bind(cell16px);
  gap: 12px;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 8px;
  box-sizing: border-box;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.profile-select {
  width: 160px;
}

.control-section {
  display: flex;
  flex-direction: column;
  gap: v-bind(cell8px);
}

.control-label {
  font-size: 13px;
  color: #606266;
}

.action-buttons {
  display: flex;
  gap: v-bind(cell8px);
}

.action-buttons .el-button {
  flex: 1;
  font-size: 12px;
}

.chart-container {
  flex: 1;
  min-height: 0;
  width: 100%;
}

/* 水位滑块区域（紧凑布局） */
.water-slider-container {
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-sizing: border-box;
}

.scale-marks {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: #909399;
  padding: 2px 0;
}

.scale-mark {
  cursor: pointer;
  transition: color 0.2s;
}

.scale-mark.clickable {
  color: #409eff;
  font-weight: 500;
}

.scale-mark.clickable:hover {
  color: #66b1ff;
  text-decoration: underline;
}
</style>
```

## 业务模块 - 选址分析

## src/business/site-selection/SiteSelectionPage.vue

```vue
<script setup lang="ts"">
/**
 * SiteSelectionPage - 选址分析业务页
 *
 * 布局（继承 Home Layout，替换 slot 内容）：
 * - 左上（4×4）：第一名小区雷达图
 * - 左下（4×4）：图层控制面板（接入真实功能）
 * - 右上（4×4）：设施因子选择面板（6 按钮 + 滑块 + 清空/分析）
 * - 右下（4×4）：小区名单列表
 *
 * 顶部标题 + 城市按钮 + 底部导航条固定不变。
 *
 * 状态保存机制：
 * - 跳转到个人中心（/profile）时保存当前状态
 * - 从个人中心返回时恢复状态
 * - 跳转到其他路由时清除状态
 */

import { ref, computed, onMounted, onUnmounted } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import type { ScoredXiaoqu, FacilityPoint, AnalysisResult } from '@/types/analysis'
import AppLayout from '@/core/layout/AppLayout.vue'
import GcsPanel from '@/core/layout/components/GcsPanel.vue'
import SiteAnalysisControlPanel from './components/SiteAnalysisControlPanel.vue'
import LayerControlPanel from '@/shared/components/LayerControlPanel.vue'
import PaginatedListPanel from '@/shared/components/PaginatedListPanel.vue'
import RadarChart from '@/visualization/charts/RadarChart.vue'
import ErrorPopup from '@/shared/components/ErrorPopup.vue'
import { useMapControls } from '@/core/map/composables/useMapControls'
import { useMapStore } from '@/stores/map'
import { useAnalysisLayer } from './composables/useAnalysisLayer'
import { useBusinessLayers } from '@/core/map/composables/useBusinessLayers'
import { useSiteSelectionStateStore } from '@/stores/siteSelectionState'
import { useLayerManager } from '@/core/map/composables/useLayerManager'
import { logger } from '@/shared/utils/logger'

const { stopBreathing, zoomToCity, zoomToDistrict, mapInstance } = useMapControls()
const mapStore = useMapStore()
const stateStore = useSiteSelectionStateStore()
const { registerToggleable } = useLayerManager()
const { manager: businessLayerManager } = useBusinessLayers()
const { createUpdateHandler } = useAnalysisLayer()

// FIX:P3-04: 保存定时器 id，卸载时清理悬挂定时器
let tryZoomTimer: ReturnType<typeof setTimeout> | null = null

/** 分析结果 */
const matchedXiaoqu = ref<ScoredXiaoqu[]>([])
const selectedTypes = ref<string[]>([])
const selectedXiaoqu = ref<ScoredXiaoqu | null>(null)

/** 覆盖范围内的设施POI数据 { type: [{lng, lat, name}] } */
const facilityPoi = ref<Record<string, FacilityPoint[]>>({})

/** 当前方案ID（用于保存小区） */
const currentPlanId = ref<string | null>(null)

/** 当前显示的设施POI图层key（互斥） */
const activeFacilityLayerKey = ref<string | null>(null)

/** 因子面板引用（用于获取/恢复状态） */
const factorPanelRef = ref<InstanceType<typeof SiteAnalysisControlPanel> | null>(null)

/** 小区列表面板引用（用于获取/恢复状态） */
const favoriteListRef = ref<InstanceType<typeof PaginatedListPanel> | null>(null)

/** P2-004-FIX: 错误弹窗状态 */
const showErrorPopup = ref<boolean>(false)
const errorMessage = ref<string>('')

/** 限制显示前8个小区 */
const displayXiaoqu = computed<ScoredXiaoqu[]>(() => matchedXiaoqu.value.slice(0, 8))

/** 第一名小区（雷达图默认显示） */
const topXiaoqu = computed<ScoredXiaoqu | null>(() => matchedXiaoqu.value[0] || null)

/** 当前显示的小区（优先显示选中的，否则显示第一名） */
const displayXiaoquForRadar = computed<ScoredXiaoqu | null>(
  () => selectedXiaoqu.value || topXiaoqu.value,
)

/** 处理分析结果 */
function handleResult(result: Partial<AnalysisResult>): void {
  logger.debug('[SiteSelection] 收到分析结果:', result)
  // FIX:P3-03: 页面级错误弹窗接线
  showErrorPopup.value = false

  // 注册分析结果处理函数（通过 BusinessLayerManager 管理图层）
  if (!mapStore.analysisHandler) {
    const updateHandler = createUpdateHandler(businessLayerManager)
    mapStore.registerAnalysisHandler(updateHandler)
  }

  mapStore.setAnalysisResult(result)
  matchedXiaoqu.value = result.matchedXiaoqu || []
  selectedTypes.value = result.selectedTypes || []
  facilityPoi.value = result.facilityPoi || {}
  selectedXiaoqu.value = null
  mapStore.setSelectedXiaoqu(null)
  stopBreathing()
  if (matchedXiaoqu.value.length > 0) {
    zoomToDistrict()
  }
}

// FIX:P3-03: 接线启用页面级错误弹窗（此前 showErrorPopup 为死代码）
function handleAnalysisError(message: string): void {
  errorMessage.value = message || '选址分析失败，请稍后重试'
  showErrorPopup.value = true
}

/**
 * 显示指定设施的POI图层（互斥，只显示一个）
 */
function handleShowFacilityLayer(data: {
  type: string
  poiList: FacilityPoint[]
  color: string
  label: string
}): void {
  const renderer = mapInstance.value?.getRenderer?.()
  if (!renderer) return

  // 先移除旧的设施POI图层
  if (activeFacilityLayerKey.value) {
    renderer.removeLayer(activeFacilityLayerKey.value)
    mapStore.removeLayer(activeFacilityLayerKey.value)
    activeFacilityLayerKey.value = null
  }

  const { type, poiList, color, label } = data
  if (!poiList || poiList.length === 0) return

  const layerKey = `facility-poi-${type}`
  const points = poiList.map((p) => ({
    lon: p.lng,
    lat: p.lat,
    name: p.name || label,
  }))

  renderer.addPointLayer(layerKey, points, {
    size: 8,
    color,
    labelField: 'name',
    featureType: layerKey,
  })

  registerToggleable(layerKey, `${label} POI`, renderer)
  activeFacilityLayerKey.value = layerKey
}

/**
 * 隐藏当前设施POI图层
 */
function handleHideFacilityLayer(): void {
  if (!activeFacilityLayerKey.value) return

  const renderer = mapInstance.value?.getRenderer?.()
  if (renderer) {
    renderer.removeLayer(activeFacilityLayerKey.value)
  }
  mapStore.removeLayer(activeFacilityLayerKey.value)
  activeFacilityLayerKey.value = null
}

/** 点击小区列表项（地图可视化已由FavoriteListPanel内置处理） */
function handleSelectXiaoqu(xq: any): void {
  // 更新本地状态，用于雷达图传参
  logger.debug('[SiteSelection] 点击小区:', xq)
  logger.debug('[SiteSelection] breakdown:', xq.breakdown)

  // 规范化字段名称（兼容 lon/lng）
  const normalizedXq: ScoredXiaoqu = {
    id: xq.id,
    name: xq.name,
    lng: xq.lng ?? xq.lon ?? 0,
    lat: xq.lat ?? xq.latitude ?? 0,
    score: xq.score ?? 0,
    breakdown: xq.breakdown || {},
  }

  selectedXiaoqu.value = normalizedXq
}

/** 收藏状态变化时同步方案ID */
function handleFavoriteChange(_data: { item: ScoredXiaoqu; isFavorite: boolean }): void {
  const planId = favoriteListRef.value?.getCurrentPlanId()
  if (planId && !currentPlanId.value) {
    currentPlanId.value = planId
  }
}

/**
 * 路由守卫：离开选址分析页时保存/清除状态
 * 规则：仅当跳转到个人中心时保存状态，其他路由清除状态
 */
onBeforeRouteLeave((to) => {
  if (to.path === '/profile') {
    // 跳转到个人中心，保存当前状态
    saveCurrentState()
  } else {
    // 跳转到其他路由，清除状态
    stateStore.clearState()
  }
})

/**
 * 保存当前页面状态到 store
 */
function saveCurrentState(): void {
  const factorSettings = factorPanelRef.value?.getSettings?.() || null
  const savedXiaoquIds = favoriteListRef.value?.getSavedIds?.() || []

  stateStore.saveState({
    factorSettings,
    matchedXiaoqu: matchedXiaoqu.value,
    selectedTypes: selectedTypes.value,
    facilityPoi: facilityPoi.value, // FIX:P1-05: 补保存设施POI
    currentPlanId: currentPlanId.value,
    savedXiaoquIds,
  })
}

/**
 * 恢复保存的状态
 */
function restoreState(): boolean {
  const savedState = stateStore.consumeState()
  if (!savedState) return false

  // 恢复分析结果
  matchedXiaoqu.value = (savedState as any).matchedXiaoqu || []
  selectedTypes.value = (savedState as any).selectedTypes || []
  facilityPoi.value = (savedState as any).facilityPoi || {} // FIX:P1-05
  currentPlanId.value = (savedState as any).currentPlanId || null

  // 恢复因子面板状态
  if ((savedState as any).factorSettings && factorPanelRef.value?.restoreSettings) {
    factorPanelRef.value.restoreSettings((savedState as any).factorSettings)
  }

  // 恢复小区结果面板状态（方案ID从savedXiaoquIds推断，实际收藏由服务端管理）
  if ((savedState as any).currentPlanId) {
    currentPlanId.value = (savedState as any).currentPlanId
  }

  // 如果有分析结果，触发结果更新
  if (matchedXiaoqu.value.length > 0) {
    // FIX:P1-05: 传全量字段，避免 handleResult 用空值覆盖已恢复状态
    handleResult({
      matchedXiaoqu: matchedXiaoqu.value,
      selectedTypes: selectedTypes.value,
      facilityPoi: facilityPoi.value,
    })
  }

  return true
}

/**
 * 清除旧的分析图层（分析覆盖范围 + 匹配小区 + 设施POI）
 * 从 mapStore catalog 和 renderer 中同时移除
 */
function clearAnalysisLayers(): void {
  // 通过 Manager 统一管理生命周期，不直接操作 renderer 和 mapStore
  if (businessLayerManager.has('analysis-coverage')) {
    businessLayerManager.remove('analysis-coverage')
  }
  if (businessLayerManager.has('analysis-matched')) {
    businessLayerManager.remove('analysis-matched')
  }

  // 清除设施POI图层
  if (activeFacilityLayerKey.value) {
    const r = mapInstance.value?.getRenderer?.()
    mapStore.removeLayer(activeFacilityLayerKey.value)
    if (r) {
      r.removeLayer(activeFacilityLayerKey.value)
    }
    activeFacilityLayerKey.value = null
  }
}

onMounted(() => {
  // 尝试恢复保存的状态（从个人中心返回）
  const restored = restoreState()

  if (restored) {
    // 从个人中心返回，保留状态，不清除图层
  } else {
    // 非个人中心返回，清除旧分析图层
    clearAnalysisLayers()
    // P1-001-FIX: 等待渲染器就绪后再缩放，最多重试10次
    let retries = 0
    const tryZoom = () => {
      if (mapInstance.value?.getRenderer?.()) {
        zoomToCity()
      } else if (retries < 10) {
        retries++
        // FIX:P3-04: 保存定时器 id，卸载时清理
        tryZoomTimer = setTimeout(tryZoom, 500)
      }
    }
    tryZoom()
  }
})

onUnmounted(() => {
  stopBreathing()
  // FIX:P3-04: 清理悬挂的 tryZoom 定时器
  if (tryZoomTimer) {
    clearTimeout(tryZoomTimer)
    tryZoomTimer = null
  }
})
</script>

<template>
  <div class=""site-selection-page"">
    <AppLayout>
      <!-- 左侧：左上雷达图 + 左下图层控制 -->
      <template #left>
        <!-- 左上：小区雷达图 4×4（显示选中小区或第一名） -->
        <GcsPanel :w=""4"" :h=""4"" anchor=""top-left"" :offset-x=""0"" :offset-y=""1.25"">
          <RadarChart
            :visible=""true""
            :embedded=""true""
            :xiaoqu=""displayXiaoquForRadar""
            :selected-types=""selectedTypes""
            :facility-poi=""facilityPoi""
            @show-facility-layer=""handleShowFacilityLayer""
            @hide-facility-layer=""handleHideFacilityLayer""
          />
        </GcsPanel>
        <!-- 左下：图层控制面板 4×4 -->
        <GcsPanel :w=""4"" :h=""4"" anchor=""top-left"" :offset-x=""0"" :offset-y=""5.5"">
          <LayerControlPanel />
        </GcsPanel>
      </template>

      <!-- 右侧：右上因子面板 + 右下小区名单 -->
      <template #right>
        <!-- 右上：设施因子选择面板 4×4 -->
        <GcsPanel :w=""4"" :h=""4"" anchor=""top-right"" :offset-x=""0"" :offset-y=""1.25"">
          <SiteAnalysisControlPanel
            ref=""factorPanelRef""
            @result-update=""handleResult""
            @analysis-error=""handleAnalysisError""
          />
        </GcsPanel>
        <!-- 右下：小区名单列表 4×4 -->
        <GcsPanel :w=""4"" :h=""4"" anchor=""top-right"" :offset-x=""0"" :offset-y=""5.5"">
          <PaginatedListPanel
            ref=""favoriteListRef""
            :items=""displayXiaoqu""
            :page-size=""4""
            title=""小区名单""
            empty-text=""暂无分析结果""
            plan-type=""site-selection""
            @click-item=""handleSelectXiaoqu""
            @favorite-change=""handleFavoriteChange""
          >
            <template #item=""{ item: xq, index }"">
              <span class=""xq-rank"">{{ index + 1 }}</span>
              <span class=""xq-name"">{{ xq.name }}</span>
              <span class=""xq-score"">{{ xq.score }}分</span>
            </template>
          </PaginatedListPanel>
        </GcsPanel>
      </template>
    </AppLayout>

    <!-- P2-004-FIX: 错误提示弹窗 -->
    <ErrorPopup :visible=""showErrorPopup"" :message=""errorMessage"" @close=""showErrorPopup = false"" />
  </div>
</template>

<style scoped>
.site-selection-page {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.xq-rank {
  color: #909399;
  font-size: 12px;
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}

.xq-name {
  color: #303133;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  text-align: center;
  min-width: 0;
}

.xq-score {
  color: #409eff;
  font-weight: 600;
  flex-shrink: 0;
  min-width: 50px;
  text-align: right;
}
</style>
```

## src/business/site-selection/components/SiteAnalysisControlPanel.vue

```vue
<script setup lang="ts"">
// 选址分析控制面板：4×4 Panel，2列×4行网格，6个设施因子按钮 + 清空/分析
// 按钮三态：默认(白) → 选择(蓝,滑块,3s自动确认) → 已选(白+重要程度标签)
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { FACILITY_CONFIG } from '../composables/facilityConfig'
import { useSiteAnalysisApi } from '../composables/useSiteAnalysisApi'
import type { AnalysisResult, TypeSetting, FacilityType } from '@/types/analysis'
import ErrorPopup from '@/shared/components/ErrorPopup.vue'

interface Emits {
  (_e: 'result-update', _result: Partial<AnalysisResult>): void
  (_e: 'analysis-error', _message: string): void
}

const emit = defineEmits<Emits>()

/** 面板元素引用（用于外部点击检测） */
const panelRef = ref<HTMLElement | null>(null)

/** 自动确认延迟（毫秒） */
const CONFIRM_DELAY = 3000

/** 扩展 TypeSetting，添加 selecting 状态 */
interface LocalTypeSetting extends TypeSetting {
  selecting: boolean
}

/** 使用 reactive 确保所有属性响应式 */
const typeSettings = reactive<Record<string, LocalTypeSetting>>({})
Object.entries(FACILITY_CONFIG).forEach(([key]) => {
  typeSettings[key] = { selected: false, importance: 3, selecting: false, defaultRadius: 0 }
})

/** 计时器存储（不需要响应式） */
const confirmTimers: Record<string, ReturnType<typeof setTimeout> | null> = {}

/** 已选中的设施 key 列表 */
const selectedKeys = computed<string[]>(() =>
  Object.entries(typeSettings)
    .filter(([, v]) => v.selected)
    .map(([k]) => k),
)

const { analyze, calculating, calcError } = useSiteAnalysisApi()

/** 弹窗状态 */
const showPopup = ref<boolean>(false)
const popupMessage = ref<string>('')

/** 清除指定因子的计时器 */
function clearTimer(key: string): void {
  if (confirmTimers[key]) {
    clearTimeout(confirmTimers[key]!)
    confirmTimers[key] = null
  }
}

/** 启动指定因子的自动确认计时器 */
function startConfirmTimer(key: string): void {
  clearTimer(key)
  confirmTimers[key] = setTimeout(() => {
    if (typeSettings[key]) {
      typeSettings[key].selecting = false
    }
    confirmTimers[key] = null
  }, CONFIRM_DELAY)
}

/** 重置指定因子的计时器（用户操作滑块时调用） */
function resetConfirmTimer(key: string): void {
  if (typeSettings[key]?.selecting) {
    startConfirmTimer(key)
  }
}

/** 切换设施选择状态 */
function toggleFactor(key: string): void {
  const setting = typeSettings[key]
  if (!setting) return

  if (setting.selected && !setting.selecting) {
    // 已选态 → 重新进入选择态
    setting.selecting = true
    startConfirmTimer(key)
  } else if (!setting.selected) {
    // 默认态 → 进入选择态
    setting.selected = true
    setting.selecting = true
    startConfirmTimer(key)
  }
  // selecting 状态下点击不做处理，避免干扰滑块操作
}

/** 确认所有选择（点击外部区域时触发） */
function confirmAll(): void {
  Object.entries(typeSettings).forEach(([key, v]) => {
    v.selecting = false
    clearTimer(key)
  })
}

/** 清空所有选择 */
function clearAll(): void {
  Object.entries(typeSettings).forEach(([key, v]) => {
    v.selected = false
    v.selecting = false
    clearTimer(key)
  })
  emit('result-update', { coverage: null, matchedXiaoqu: [], facilityPoi: {}, selectedTypes: [] })
}

/** 开始分析 */
async function runAnalysis(): Promise<void> {
  // FIX:105: 防重复提交守卫
  if (calculating.value) {
    // P2-003-FIX: 向用户展示可视化反馈
    popupMessage.value = '分析正在进行中，请稍候'
    showPopup.value = true
    return
  }

  calcError.value = ''
  // 先确认所有选择
  confirmAll()
  if (selectedKeys.value.length === 0) {
    popupMessage.value = '请至少选择一种设施类型'
    showPopup.value = true
    return
  }
  // 构造后端期望的 typeSettings 格式
  const apiTypeSettings: Record<string, TypeSetting> = {}
  selectedKeys.value.forEach((key) => {
    const config = FACILITY_CONFIG[key as FacilityType]
    apiTypeSettings[key] = {
      defaultRadius: config.defaultRadius,
      importance: typeSettings[key].importance,
      selected: true,
    }
  })
  const result = await analyze({
    selectedKeys: selectedKeys.value as FacilityType[],
    typeSettings: apiTypeSettings,
  })
  if (calcError.value) {
    popupMessage.value = calcError.value || '网络异常，请重试'
    showPopup.value = true
    // FIX:P3-03: 向页面级错误弹窗传递错误
    emit('analysis-error', calcError.value)
    return
  }
  emit('result-update', {
    coverage: result.coverage ?? null,
    matchedXiaoqu: result.matchedXiaoqu ?? [],
    facilityPoi: result.facilityPoi ?? {},
    selectedTypes: selectedKeys.value,
  })
}

/** 重试分析 */
async function handleRetry(): Promise<void> {
  showPopup.value = false
  popupMessage.value = ''
  await runAnalysis()
}

/** 关闭弹窗 */
function handleClosePopup(): void {
  showPopup.value = false
  popupMessage.value = ''
  calcError.value = ''
}

/** 重要性标签 */
const IMPORTANCE_LABELS: Record<number, string> = {
  1: '不太在意',
  2: '稍微在意',
  3: '一般重要',
  4: '比较重要',
  5: '非常重要',
}

/** 设施列表（转为数组供 v-for 使用） */
const facilityList = computed(() =>
  Object.entries(FACILITY_CONFIG).map(([key, conf]) => ({
    key,
    ...conf,
    setting: typeSettings[key],
  })),
)

/** 点击外部区域立即结束所有选择态 */
function handleGlobalClick(e: MouseEvent): void {
  if (panelRef.value && !panelRef.value.contains(e.target as Node)) {
    confirmAll()
  }
}

onMounted(() => {
  document.addEventListener('click', handleGlobalClick)
})

onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick)
  // 清理所有计时器
  Object.values(confirmTimers).forEach((timer) => {
    if (timer) clearTimeout(timer)
  })
})

function getSettings() {
  return JSON.parse(JSON.stringify(typeSettings))
}

function restoreSettings(settings: Record<string, any>) {
  if (!settings) return
  Object.entries(settings).forEach(([key, value]) => {
    if (typeSettings[key]) {
      typeSettings[key].selected = value.selected || false
      typeSettings[key].importance = value.importance || 3
      typeSettings[key].selecting = false
    }
  })
}

defineExpose({
  getSettings,
  restoreSettings,
})
</script>

<template>
  <div class=""factor-panel"" ref=""panelRef"">
    <!-- 8 个按钮，2 列 × 4 行 -->
    <div class=""factor-grid"">
      <!-- 6 个设施因子按钮 -->
      <div
        v-for=""item in facilityList""
        :key=""item.key""
        class=""factor-item""
        :class=""{ selected: item.setting.selected, selecting: item.setting.selecting }""
      >
        <!-- 默认态：白色按钮，仅显示设施名称 -->
        <button
          v-if=""!item.setting.selected""
          class=""factor-btn""
          @click.stop=""toggleFactor(item.key)""
        >
          <span class=""factor-dot"" :style=""{ color: item.color }"">●</span>
          <span class=""factor-label"">{{ item.label }}</span>
        </button>

        <!-- 选择态：蓝色背景 + 滑块 -->
        <div
          v-else-if=""item.setting.selecting""
          class=""factor-slider-wrap""
          @mousedown.stop
          @click.stop
        >
          <span class=""factor-dot"" :style=""{ color: item.color }"">●</span>
          <input
            type=""range""
            class=""factor-slider""
            min=""1""
            max=""5""
            v-model.number=""item.setting.importance""
            @input=""resetConfirmTimer(item.key)""
            @mousedown.stop
            @click.stop
          />
          <span class=""factor-importance"">{{ IMPORTANCE_LABELS[item.setting.importance] }}</span>
        </div>

        <!-- 已选态：白色按钮，显示名称 + 重要程度 -->
        <button v-else class=""factor-btn confirmed"" @click.stop=""toggleFactor(item.key)"">
          <span class=""factor-dot"" :style=""{ color: item.color }"">●</span>
          <span class=""factor-label"">{{ item.label }}</span>
          <span class=""factor-level"">{{ IMPORTANCE_LABELS[item.setting.importance] }}</span>
        </button>
      </div>

      <!-- 第 4 行：清空选择 + 开始分析 -->
      <button class=""factor-btn action-btn clear-btn"" @click.stop=""clearAll"">
        <span class=""factor-label"">清空选择</span>
      </button>
      <button
        class=""factor-btn action-btn analyze-btn""
        :disabled=""calculating""
        @click.stop=""runAnalysis""
      >
        <span class=""factor-label"">{{ calculating ? '分析中...' : '开始分析' }}</span>
      </button>
    </div>

    <!-- 错误/提示弹窗 -->
    <ErrorPopup
      :visible=""showPopup""
      :message=""popupMessage""
      @close=""handleClosePopup""
      @retry=""handleRetry""
    />
  </div>
</template>

<style scoped>
.factor-panel {
  width: 100%;
  height: 100%;
  padding: 10px;
  box-sizing: border-box;
}

/* 按钮网格：2 列 × 4 行（与图层控制面板一致） */
.factor-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: repeat(4, 1fr);
  gap: 10px;
  height: 100%;
}

.factor-item {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  width: 100%;
  height: 100%;
}

/* 默认态 / 已选态：白色按钮 */
.factor-btn {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: #ffffff;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  cursor: pointer;
  font-size: 13px;
  color: #333;
  transition: all 0.2s ease;
  padding: 6px 4px;
  box-sizing: border-box;
}

.factor-btn:hover {
  border-color: #409eff;
  background: #f0f7ff;
}

.factor-dot {
  font-size: 12px;
  line-height: 1;
}

.factor-label {
  font-weight: 500;
  line-height: 1.2;
}

/* 已选态：带重要程度标签 */
.factor-btn.confirmed {
  gap: 2px;
}

.factor-level {
  font-size: 10px;
  color: #409eff;
  line-height: 1;
}

/* 选择态：蓝色背景 + 滑块 */
.factor-item.selected.selecting {
  background: #409eff;
  border-radius: 12px;
}

.factor-slider-wrap {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 8px;
  box-sizing: border-box;
  cursor: default;
}

.factor-slider {
  width: 80%;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
  margin: 0;
}

.factor-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  cursor: pointer;
  border: none;
}

.factor-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  cursor: pointer;
  border: none;
}

.factor-importance {
  font-size: 10px;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  text-align: center;
}

/* 操作按钮样式 */
.action-btn.clear-btn {
  color: #333;
}

.action-btn.clear-btn:hover {
  border-color: #409eff;
  color: #409eff;
}

.action-btn.analyze-btn {
  background: #409eff;
  color: #fff;
  border-color: #409eff;
}

.action-btn.analyze-btn:hover:not(:disabled) {
  background: #66b1ff;
  border-color: #66b1ff;
}

.action-btn.analyze-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
```

## src/business/site-selection/composables/facilityConfig.js

```javascript
export const FACILITY_CONFIG = {
  hospital: {
    label: '医院'',
    color: ''#e74c3c'',
    defaultRadius: 3,
  },
  primary_school: {
    label: ''小学'',
    color: ''#3498db'',
    defaultRadius: 1,
  },
  middle_school: {
    label: ''中学'',
    color: ''#9b59b6'',
    defaultRadius: 2,
  },
  park: {
    label: ''公园'',
    color: ''#2ecc71'',
    defaultRadius: 1.5,
  },
  bus_station: {
    label: ''公交站'',
    color: ''#f39c12'',
    defaultRadius: 0.5,
  },
  mall: {
    label: ''商场'',
    color: ''#1abc9c'',
    defaultRadius: 2,
  },
}
```

## src/business/site-selection/composables/useAnalysisLayer.js

```javascript
export function buildCoverageGeoJson(coverage) {
  if (!coverage) {
    return { type: 'FeatureCollection'', features: [] }
  }
  let geojson
  if (coverage.type === ''FeatureCollection'') {
    geojson = { ...coverage }
    geojson.features = coverage.features.map((f) => ({
      ...f,
      properties: { ...f.properties, featureType: ''analysis-coverage'' },
    }))
  } else {
    geojson = {
      type: ''FeatureCollection'',
      features: [
        { ...coverage, properties: { ...coverage.properties, featureType: ''analysis-coverage'' } },
      ],
    }
  }
  return geojson
}

export function buildMatchedGeoJson(matchedXiaoqu) {
  return {
    type: ''FeatureCollection'',
    features: matchedXiaoqu
      .filter((xq) => {
        if (xq.lng === undefined || xq.lat === undefined) {
          if (import.meta.env.DEV) {
            console.warn(''小区数据缺少坐标字段:'', xq)
          }
          return false
        }
        if (typeof xq.lng !== ''number'' || typeof xq.lat !== ''number'') {
          if (import.meta.env.DEV) {
            console.warn(''小区坐标字段类型无效:'', xq)
          }
          return false
        }
        if (xq.lng < -180 || xq.lng > 180 || xq.lat < -90 || xq.lat > 90) {
          if (import.meta.env.DEV) {
            console.warn(''小区坐标值超出有效范围:'', xq)
          }
          return false
        }
        return true
      })
      .map((xq) => ({
        type: ''Feature'',
        geometry: {
          type: ''Point'',
          coordinates: [xq.lng, xq.lat],
        },
        properties: {
          ...xq,
          featureType: ''analysis-matched'',
        },
      })),
  }
}

export const COVERAGE_STYLE = {
  fillColor: ''rgba(64, 158, 255, 0.15)'',
  strokeColor: ''#409eff'',
  strokeWidth: 1,
  featureType: ''analysis-coverage'',
}

export const MATCHED_STYLE = {
  size: 6,
  color: ''#e74c3c'',
  featureType: ''analysis-matched'',
}

/**
 * 创建选址分析结果处理函数
 *
 * 通过 BusinessLayerManager 管理图层生命周期，
 * 不再直接调用 renderer 方法。
 *
 * @param {BusinessLayerManager} businessLayerManager
 * @returns {Function} setAnalysisResult(result)
 */
export function useAnalysisLayer() {
  let isUpdating = false
  let pendingResult = null

  function getAnalysisLayers(result) {
    const layers = []

    if (result.coverage) {
      layers.push({
        id: ''analysis-coverage'',
        label: ''分析覆盖范围'',
        geojson: buildCoverageGeoJson(result.coverage),
        style: COVERAGE_STYLE,
      })
    }

    if (result.matchedXiaoqu?.length) {
      layers.push({
        id: ''analysis-matched'',
        label: ''匹配小区'',
        geojson: buildMatchedGeoJson(result.matchedXiaoqu),
        style: MATCHED_STYLE,
      })
    }

    return layers
  }

  function createUpdateHandler(businessLayerManager) {
    return async function setAnalysisResult(result) {
      if (isUpdating) {
        pendingResult = result
        return
      }
      isUpdating = true
      try {
        const layers = getAnalysisLayers(result)
        for (const layer of layers) {
          if (!businessLayerManager.has(layer.id)) {
            businessLayerManager.register(layer.id, {
              label: layer.label,
              layerType: ''geojson'',
              data: layer.geojson,
              options: layer.style,
              visible: true,
            })
          } else {
            businessLayerManager.updateData(layer.id, {
              data: layer.geojson,
              options: layer.style,
            })
          }
        }
      } finally {
        isUpdating = false
        if (pendingResult) {
          const next = pendingResult
          pendingResult = null
          await setAnalysisResult(next)
        }
      }
    }
  }

  return { getAnalysisLayers, createUpdateHandler }
}
```

## src/business/site-selection/composables/useFacilities.js

```javascript
export { FACILITY_CONFIG } from './facilityConfig''
```

## src/business/site-selection/composables/useSiteAnalysisApi.ts

```typescript
import { ref } from 'vue''
import type { Ref } from ''vue''
import type { AnalysisParams, AnalysisResult } from ''@/types/analysis''
import { useApiRequest, ApiError, ErrorCode } from ''@/shared/composables/useApiRequest''

export function useSiteAnalysisApi() {
  const { apiRequest } = useApiRequest()
  const calculating: Ref<boolean> = ref(false)
  const calcError: Ref<string> = ref('''')

  async function analyze(params: AnalysisParams): Promise<AnalysisResult> {
    // FIX:P03: 请求去重，防止重复提交
    if (calculating.value) {
      if (import.meta.env.DEV) {
        console.warn(''[useSiteAnalysisApi] 分析请求已在进行中，忽略重复请求'')
      }
      return { error: ''正在分析中，请稍后再试'', coverage: null, matchedXiaoqu: [], facilityPoi: {} }
    }

    calcError.value = ''''
    calculating.value = true
    try {
      const result = await apiRequest<AnalysisResult>(''/site-analysis'', {
        method: ''POST'',
        body: JSON.stringify(params),
      })
      if (result.error) {
        calcError.value = result.error
        // FIX:009: 返回完整的错误对象结构
        return { 
          error: result.error, 
          coverage: null, 
          matchedXiaoqu: [],
          facilityPoi: {}
        }
      }
      // FIX:009: 确保返回对象结构完整
      return {
        error: null,
        coverage: result.coverage || null,
        matchedXiaoqu: result.matchedXiaoqu || [],
        facilityPoi: result.facilityPoi || {}
      }
    } catch (error) {
      // FIX:P3-002: 使用错误码替代字符串匹配，提高可维护性
      if (error instanceof ApiError) {
        switch (error.code) {
          case ErrorCode.TIMEOUT:
            calcError.value = ''请求超时，请稍后重试''
            break
          case ErrorCode.UNAUTHORIZED:
            calcError.value = ''请先登录''
            break
          case ErrorCode.SERVER_ERROR:
            calcError.value = ''服务器错误，请稍后重试''
            break
          case ErrorCode.NETWORK_ERROR:
            calcError.value = ''网络异常，请检查网络连接''
            break
          case ErrorCode.REQUEST_FAILED:
            calcError.value = ''参数错误，请检查输入''
            break
          default:
            calcError.value = ''网络异常，请稍后重试''
        }
      } else {
        calcError.value = ''网络异常，请稍后重试''
      }
      // FIX:009: 保持返回结构完整
      return { error: calcError.value, coverage: null, matchedXiaoqu: [], facilityPoi: {} }
    } finally {
      calculating.value = false
    }
  }

  return { analyze, calculating, calcError }
}
```

## 共享组件

## src/shared/components/ErrorBoundary.vue

```vue
<script setup>
import { ref, onErrorCaptured } from 'vue''

const hasError = ref(false)
const errorMsg = ref('''')

onErrorCaptured((err) => {
  // FIX:015 (错误): 错误上报（可集成 Sentry 等服务）
  if (import.meta.env.DEV) {
    console.error(''[ErrorBoundary]'', err)
    console.error(''错误堆栈:'', err.stack)
  }
  // 错误上报服务待集成（如 Sentry）
  
  errorMsg.value = err.message || ''未知异常''
  hasError.value = true
  return false // 阻止冒泡到全局
})
function reset() {
  hasError.value = false
  errorMsg.value = ''''
}
</script>

<template>
  <div v-if="hasError" class="eb-wrap">
    <p>应用异常: {{ errorMsg }}</p>
    <button @click="reset">重试</button>
  </div>
  <slot v-else />
</template>

<style scoped>
.eb-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  gap: 12px;
}
</style>
```

## src/shared/components/ErrorPopup.vue

```vue
<script setup>
/**
 * ErrorPopup - 通用提示弹窗
 *
 * 规格：4×3 Cell 面板，居中显示
 * - 右上角：关闭按钮（×）
 * - 内容区：提示信息
 * - 底部：两个并列按钮
 *   - 主按钮（蓝色，1.8×0.8 cell）：重试 或 去登录
 *   - 次按钮（白色，1.8×0.8 cell）：取消
 *
 * 两种模式：
 * - mode='error'：显示"重试"和"取消"按钮
 * - mode='login'：显示"去登录"和"取消"按钮
 */

import { useGCS } from '@/core/layout/useGCS.js''
import { useRouter } from ''vue-router''

defineProps({
  visible: { type: Boolean, default: false },
  message: { type: String, default: ''网络异常，请重试'' },
  /** 弹窗模式：''error'' 或 ''login'' */
  mode: { type: String, default: ''error'', validator: (v) => [''error'', ''login''].includes(v) },
})

const emit = defineEmits([''close'', ''retry''])
const router = useRouter()

const { panelPosition } = useGCS()

function handleClose() {
  emit(''close'')
}

function handleRetry() {
  emit(''retry'')
}

function handleLogin() {
  emit(''close'') // 先关闭弹窗
  router.push(''/profile'') // 跳转到登录页
}
</script>

<template>
  <Transition name="fade">
    <div v-if="visible" class="error-popup-overlay" @click.self="handleClose">
      <div class="error-popup-panel" :style="panelPosition(4, 3, ''top-center'', 0, 3)">
        <!-- 关闭按钮 -->
        <button class="close-btn" @click="handleClose" aria-label="关闭">×</button>

        <!-- 错误图标 -->
        <div class="error-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="#E74C3C" stroke-width="2"/>
            <path d="M12 8V13" stroke="#E74C3C" stroke-width="2" stroke-linecap="round"/>
            <circle cx="12" cy="16" r="1" fill="#E74C3C"/>
          </svg>
        </div>

        <!-- 错误信息 -->
        <p class="error-message">{{ message }}</p>

        <!-- 底部按钮组：两个并列按钮 -->
        <div class="button-group">
          <!-- 主按钮（蓝色）：重试 或 去登录 -->
          <button
            v-if="mode === ''login''"
            class="action-btn primary-btn"
            @click="handleLogin"
          >
            去登录
          </button>
          <button
            v-else
            class="action-btn primary-btn"
            @click="handleRetry"
          >
            重试
          </button>

          <!-- 次按钮（白色）：取消 -->
          <button class="action-btn cancel-btn" @click="handleClose">取消</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.error-popup-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(2px);
}

.error-popup-panel {
  position: absolute;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  padding: 20px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.close-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  color: #999;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  background: #f0f0f0;
  color: #333;
}

.error-icon {
  font-size: 36px;
  line-height: 1;
}

.error-message {
  margin: 0;
  font-size: 15px;
  color: #333;
  text-align: center;
  line-height: 1.5;
}

/* 底部按钮组：两个并列按钮 */
.button-group {
  display: flex;
  gap: 12px;
  width: 100%;
  justify-content: center;
}

/* 操作按钮基础样式（1.8×0.8 cell 规格） */
.action-btn {
  width: 144px; /* 1.8 × 80px */
  height: 64px; /* 0.8 × 80px */
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

/* 主按钮（蓝色）：重试/去登录 */
.primary-btn {
  background: #409eff;
  color: #fff;
}

.primary-btn:hover {
  background: #66b1ff;
}

.primary-btn:active {
  transform: scale(0.98);
}

/* 取消按钮（白色） */
.cancel-btn {
  background: #ffffff;
  color: #333;
  border: 1px solid #e0e0e0;
}

.cancel-btn:hover {
  border-color: #409eff;
  background: #f0f7ff;
}

.cancel-btn:active {
  transform: scale(0.98);
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
```

## src/shared/components/LayerControlPanel.vue

```vue
<script setup>
/**
 * LayerControlPanel - 通用图层控制面板（公共组件）
 *
 * 职责：
 * 1. 显示图层按钮（2列网格布局）
 * 2. 接入真实图层管理（useLayerManager）
 * 3. 底图互斥（影像/矢量只能选一个）
 * 4. 业务图层无互斥（可多选）
 *
 * 被引用：首页、选址分析、浸没分析
 */

import { computed } from 'vue'
import { useLayerManager } from '@/core/map/composables/useLayerManager'
import { useBusinessLayers } from ''@/core/map/composables/useBusinessLayers''
import { useGCS } from ''@/core/layout/useGCS.js''

const { layerCatalog, toggleLayer } = useLayerManager()
const { manager: businessLayerManager } = useBusinessLayers()
const { cellPixel, css } = useGCS()
// 解构出 CSS 变量供 v-bind() 使用
const { cell8px } = css

/** 按钮尺寸：1.8宽 × 0.8高（cell单位） */
const btnWidthCss = computed(() => `${cellPixel.value * 1.8}px`)   // 144px
const btnHeightCss = computed(() => `${cellPixel.value * 0.8}px`)  // 64px
/** 字体大小：0.175cell = 14px（基准），0.1cell = 8px（小字） */
const labelFontSizeCss = computed(() => `${cellPixel.value * 0.175}px`)  // 14px
const iconFontSizeCss = computed(() => `${cellPixel.value * 0.2}px`)     // 16px

/** 图层按钮列表（按显示顺序） */
const layerButtons = computed(() => {
  // 优先按预定义顺序显示，未匹配的图层追加到末尾
  const order = [
    ''base-image'',
    ''base-vector'',
    ''boundary'',
    ''ports'',
    ''analysis-coverage'',
    ''analysis-matched'',
    ''gcs-water-surface'',
    ''gcs-flood-area'',
    ''gcs-facilities'',
    ''forecast-throughput'',
    ''forecast-berth'',
    ''forecast-traffic'',
    ''forecast-pressure'',
  ]
  const ordered = order
    .map((key) => layerCatalog.value.find((l) => l.key === key))
    .filter(Boolean)
  const orderedKeys = new Set(ordered.map((l) => l.key))
  const extra = layerCatalog.value.filter((l) => !orderedKeys.has(l.key))
  return [...ordered, ...extra].map((layer) => ({
    key: layer.key,
    label: layer.label,
    active: layer.visible,
  }))
})

/** 图层图标映射 */
function getLayerIcon(label) {
  if (label.includes(''底图'') || label.includes(''影像'') || label.includes(''矢量'')) return ''🗺''
  if (label.includes(''港口'')) return ''''
  if (label.includes(''行政'')) return ''''
  if (label.includes(''覆盖'') || label.includes(''缓冲'')) return ''◎''
  if (label.includes(''匹配'') || label.includes(''结果'')) return ''◈''
  if (label.includes(''水面'')) return ''''
  if (label.includes(''淹没'')) return ''🌊''
  if (label.includes(''设施'')) return ''🏭''
  if (label.includes(''预测'') || label.includes(''吞吐'') || label.includes(''泊位'') || label.includes(''流量'') || label.includes(''压力'')) return ''📈''
  return ''''
}

/** 点击图层按钮 */
function handleToggle(key) {
  // 业务图层（有 layerType 字段，无 show/hide 回调）→ 走 Manager.setVisible
  const catalogEntry = layerCatalog.value.find((e) => e.key === key)
  if (catalogEntry && catalogEntry.layerType) {
    businessLayerManager.setVisible(key, !catalogEntry.visible)
    return
  }
  // 底图、边界、港口等旧机制图层 → 走原来的 toggleLayer
  toggleLayer(key)
}
</script>

<template>
  <div class="layer-panel">
    <div class="layer-grid">
      <button
        v-for="item in layerButtons"
        :key="item.key"
        class="layer-btn"
        :class="{ active: item.active }"
        @click="handleToggle(item.key)"
      >
        <span class="layer-icon">{{ getLayerIcon(item.label) }}</span>
        <span class="layer-label">{{ item.label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.layer-panel {
  width: 100%;
  height: 100%;
  padding: v-bind(cell8px);
  box-sizing: border-box;
}

/* 图层按钮网格：2列，自动行数 */
.layer-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: v-bind(cell8px);
  height: 100%;
  align-content: start;
}

.layer-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: v-bind(cell8px);
  width: v-bind(btnWidthCss);
  height: v-bind(btnHeightCss);
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  background: #ffffff;
  color: #333;
  cursor: pointer;
  font-size: v-bind(labelFontSizeCss);
  transition: all 0.2s ease;
  padding: v-bind(cell8px) 4px;
  box-sizing: border-box;
  justify-self: center;
}

.layer-btn:hover {
  border-color: #409eff;
  background: #f0f7ff;
}

.layer-btn.active {
  background: #409eff;
  color: #fff;
  border-color: #409eff;
}

.layer-icon {
  font-size: v-bind(iconFontSizeCss);
  line-height: 1;
}

.layer-label {
  font-weight: 500;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
</style>
```

## src/shared/components/LoginPanel.vue

```vue
<script setup>
/**
 * LoginPanel - 登录/注册面板（4×8 Cell）
 *
 * 布局规格：
 * - 顶部：标题 "个人主页""（1×0.5 Cell）
 * - 第2行：登录/注册按钮并排（各 1.8×0.8 Cell，中间留 0.4 Cell 间隙）
 * - 中间区域：用户名/密码输入框 + 错误提示 + 提交按钮
 * - 底部：退出登录按钮（3.8×0.8 Cell）
 *
 * 功能：复用 useAuth 的登录/注册/登出逻辑，默认显示登录表单。
 */

import { ref, computed } from 'vue'
import { useAuth } from '@/shared/composables/useAuth'
import { useGCS } from '@/core/layout/useGCS.js'

const { login, register, logout, user } = useAuth()
const { cellPixel, css } = useGCS()
// 解构出 CSS 变量供 v-bind() 使用
const { cell16px } = css

const mode = ref('login') // 'login' | 'register'
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const errorMsg = ref('')
const loading = ref(false)

// CSS v-bind 计算属性（使用响应式 cellPixel，随视口变化）
const panelPaddingCss = computed(() => `${cellPixel.value * 0.125}px`) // 10px
const titleFontSizeCss = computed(() => `${cellPixel.value * 0.225}px`) // 18px
const inputFontSizeCss = computed(() => `${cellPixel.value * 0.175}px`) // 14px
const btnFontSizeCss = computed(() => `${cellPixel.value * 0.175}px`) // 14px
const errorFontSizeCss = computed(() => `${cellPixel.value * 0.15}px`) // 12px
const avatarFontSizeCss = computed(() => `${cellPixel.value * 0.6}px`) // 48px = 0.6cell
// 1.8×0.8 Cell 按钮尺寸
const modeBtnWidthCss = computed(() => `${cellPixel.value * 1.8}px`) // 144px
const modeBtnHeightCss = computed(() => `${cellPixel.value * 0.8}px`) // 64px
// 3.8×0.8 Cell 表单控件尺寸（输入框 + 提交按钮 + 退出按钮）
const formWidthCss = computed(() => `${cellPixel.value * 3.8}px`) // 304px
const formHeightCss = computed(() => `${cellPixel.value * 0.8}px`) // 64px

function switchMode(m) {
  mode.value = m
  errorMsg.value = ''
  confirmPassword.value = ''
}

async function handleSubmit() {
  errorMsg.value = ''
  const trimmedUsername = username.value.trim()
  
  // FIX:019: 使用显式布尔转换
  if (username.value.trim() === '' || password.value === '') {
    errorMsg.value = '请填写用户名和密码'
    return
  }
  
  // FIX:101: 用户名长度校验（2-20 字符）
  if (trimmedUsername.length < 2 || trimmedUsername.length > 20) {
    errorMsg.value = '用户名长度应在 2-20 个字符之间'
    return
  }
  
  // FIX:102: 用户名特殊字符校验（仅允许字母、数字、中文、下划线）
  const usernameRegex = /^[\u4e00-\u9fa5a-zA-Z0-9_]+$/
  if (!usernameRegex.test(trimmedUsername)) {
    errorMsg.value = '用户名只能包含字母、数字、中文和下划线'
    return
  }
  
  if (mode.value === 'register') {
    if (password.value.length < 6) {
      errorMsg.value = '密码长度不能少于 6 位'
      return
    }
    // FIX:SEC-003: 密码强度增强 - 至少包含大小写字母和数字
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/
    if (!passwordRegex.test(password.value)) {
      errorMsg.value = '密码必须包含大小写字母和数字'
      return
    }
    if (password.value !== confirmPassword.value) {
      errorMsg.value = '两次密码输入不一致'
      return
    }
  }
  loading.value = true
  try {
    // FIX:P1-14: 密码不再 HTML 转义，原样传输（后端 bcrypt 处理，转义无安全收益）
    if (mode.value === 'login') {
      await login(trimmedUsername, password.value)
    } else {
      await register(trimmedUsername, password.value)
    }
    // 成功后清空表单
    username.value = ''
    password.value = ''
    confirmPassword.value = ''
  } catch (err) {
    // FIX:SEC-002 修复：错误信息白名单过滤，防止反射型 XSS
    const rawMsg = err.message || '操作失败'
    errorMsg.value = rawMsg.replace(/[<>""'%;()&+]/g, '')
  } finally {
    loading.value = false
  }
}

async function handleLogout() {
  await logout()
  mode.value = 'login'
  username.value = ''
  password.value = ''
  confirmPassword.value = ''
}
</script>

<template>
  <div class=""login-panel"">
    <!-- 未登录状态：登录/注册表单 -->
    <template v-if=""!user"">
      <!-- 登录/注册切换按钮（1.8×0.8 Cell 并排） -->
      <div class=""mode-buttons"">
        <button class=""mode-btn"" :class=""{ active: mode === 'login' }"" @click=""switchMode('login')"">
          登录
        </button>
        <button
          class=""mode-btn""
          :class=""{ active: mode === 'register' }""
          @click=""switchMode('register')""
        >
          注册
        </button>
      </div>

      <!-- 表单区域 -->
      <div class=""form-area"">
        <input
          v-model=""username""
          class=""form-input""
          type=""text""
          placeholder=""用户名""
          autocomplete=""username""
          @keydown.enter=""handleSubmit""
        />
        <input
          v-model=""password""
          class=""form-input""
          type=""password""
          placeholder=""密码""
          autocomplete=""current-password""
          @keydown.enter=""handleSubmit""
        />
        <input
          v-if=""mode === 'register'""
          v-model=""confirmPassword""
          class=""form-input""
          type=""password""
          placeholder=""确认密码""
          autocomplete=""new-password""
          @keydown.enter=""handleSubmit""
        />

        <!-- 错误提示 -->
        <div v-if=""errorMsg"" class=""error-text"">{{ errorMsg }}</div>

        <!-- 提交按钮 -->
        <button class=""submit-btn"" :disabled=""loading"" @click=""handleSubmit"">
          {{ loading ? '处理中...' : mode === 'login' ? '登录' : '注册' }}
        </button>
      </div>
    </template>

    <!-- 已登录状态：用户信息 -->
    <template v-else>
      <div class=""user-info-area"">
        <div class=""avatar-icon""></div>
        <div class=""user-name"">{{ user.username }}</div>
        <div class=""user-status"">已登录</div>
      </div>
      <!-- FIX:P1-13: 复用已有 handleLogout 与 .logout-btn 样式，补登出途径 -->
      <button class=""logout-btn"" @click=""handleLogout"">退出登录</button>
    </template>
  </div>
</template>

<style scoped>
.login-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: v-bind(panelPaddingCss);
  box-sizing: border-box;
  gap: v-bind(panelPaddingCss);
}

/* 登录/注册切换按钮（1.8×0.8 Cell） */
.mode-buttons {
  display: flex;
  gap: 10px; /* 非8的整数倍，保留 */
  justify-content: center;
}

.mode-btn {
  width: v-bind(modeBtnWidthCss);
  height: v-bind(modeBtnHeightCss);
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: #fff;
  font-size: v-bind(btnFontSizeCss);
  color: #333;
  cursor: pointer;
  transition: all 0.2s ease;
}

.mode-btn:hover {
  border-color: #409eff;
  background: #f0f7ff;
}

.mode-btn.active {
  background: #409eff;
  color: #fff;
  border-color: #409eff;
}

/* 表单区域 */
.form-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px; /* 非8的整数倍，保留 */
  justify-content: flex-start;
  align-items: center;
}

.form-input {
  width: v-bind(formWidthCss);
  height: v-bind(formHeightCss);
  padding: 0 12px; /* 12px 非8的整数倍，保留 */
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  font-size: v-bind(inputFontSizeCss);
  color: #333;
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.2s ease;
}

.form-input:focus {
  border-color: #409eff;
}

.form-input::placeholder {
  color: #999;
}

.error-text {
  font-size: v-bind(errorFontSizeCss);
  color: #ff4d4f;
  text-align: center;
  margin: 4px 0;
}

.submit-btn {
  width: v-bind(formWidthCss);
  height: v-bind(formHeightCss);
  border: none;
  border-radius: 8px;
  background: #409eff;
  color: #fff;
  font-size: v-bind(btnFontSizeCss);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.submit-btn:hover:not(:disabled) {
  background: #66b1ff;
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 用户信息区域 */
.user-info-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: v-bind(cell16px);
}

.avatar-icon {
  font-size: v-bind(avatarFontSizeCss); /* 48px = 0.6cell */
  line-height: 1;
}

.user-name {
  font-size: v-bind(titleFontSizeCss);
  font-weight: 600;
  color: #333;
}

.user-status {
  font-size: v-bind(errorFontSizeCss);
  color: #52c41a;
}

/* 退出登录按钮（3.8×0.8 Cell） */
.logout-btn {
  width: v-bind(formWidthCss);
  height: v-bind(formHeightCss);
  border: 1px solid #ff4d4f;
  border-radius: 8px;
  background: #fff;
  color: #ff4d4f;
  font-size: v-bind(btnFontSizeCss);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-top: auto;
  align-self: center;
}

.logout-btn:hover {
  background: #ff4d4f;
  color: #fff;
}
</style>
```

## src/shared/components/PaginatedListPanel.vue

```vue
<script setup lang="ts"">
/**
 * PaginatedListPanel - 通用分页列表面板（公共组件）
 *
 * 功能：
 * 1. 分页展示列表项，支持 << / < / > / >> 翻页
 * 2. 每项支持自定义插槽渲染
 * 3. 内置收藏/取消收藏逻辑（对接 usePlans）
 * 4. 接入真实登录判断
 * 5. isFavorite 基于 Plan.savedXiaoqu 真实判断
 *
 * Props:
 *   - items: Array — 数据源
 *   - pageSize: Number — 每页条数（默认4）
 *   - title: String — 面板标题
 *   - emptyText: String — 空状态主文案
 *   - emptyHint: String — 空状态副文案
 *   - planType: 'site-selection' | 'flood' — 方案类型，用于自动创建方案时命名
 *   - showFavorite: Boolean — 是否显示收藏按钮（默认true）
 *
 * Slots:
 *   - #item=""{ item, index }"" — 自定义单项内容
 *   - #empty — 自定义空状态（可选）
 *
 * Emits:
 *   - click-item=""{ item }"" — 点击列表项
 *   - favorite-change=""{ item, isFavorite }"" — 收藏状态变化
 *
 * 命名说明：
 * - 前端统一称""收藏""，后端 API 和数据库字段统一称""saved/save""
 * - `savedXiaoqu` 字段名沿用后端约定，前端不做转换以降低复杂度
 * - `isFavorite()` 是前端展示概念，调用 `saveXiaoqu/removeXiaoqu`
 * - `doSave/doRemove` 内部方法，对应后端 `saveXiaoqu/removeXiaoqu`
 */

import { ref, computed, watch } from 'vue'
import { useGCS } from '@/core/layout/useGCS.js'
import { usePlans } from '@/shared/composables/usePlans'
import { useAuth } from '@/shared/composables/useAuth'
import { useMapStore } from '@/stores/map'
import { useMapControls } from '@/core/map/composables/useMapControls'
import { ElButton, ElMessage } from 'element-plus'
import ErrorPopup from '@/shared/components/ErrorPopup.vue'
import { logger } from '@/shared/utils/logger'
import type { SavedXiaoqu } from '@/types/plan'

interface Props {
  items: any[]
  pageSize?: number
  title?: string
  emptyText?: string
  emptyHint?: string
  planType?: 'site-selection' | 'flood'
  showFavorite?: boolean
  mapInteraction?: boolean
}

interface Emits {
  (_e: 'click-item', _item: any): void
  (_e: 'favorite-change', _data: { item: any; isFavorite: boolean }): void
}

const props = withDefaults(defineProps<Props>(), {
  items: () => [],
  pageSize: 4,
  title: '',
  emptyText: '暂无数据',
  emptyHint: '',
  planType: 'site-selection',
  showFavorite: true,
  mapInteraction: true,
})

const emit = defineEmits<Emits>()

// 从 useGCS 解构 CSS 变量供 v-bind() 使用
const { css } = useGCS()
const { cell8px, cell16px, cell40px, fontSizeTitle, fontSizeBody, fontSizeSmall } = css
const { createPlan, saveXiaoqu, removeXiaoqu } = usePlans()
const { isAuthenticated } = useAuth()
const mapStore = useMapStore()
const { flyTo, startBreathing } = useMapControls()

/** 统一的登录状态判断：使用 isAuthenticated 而非 user.value */
const isLoggedIn = computed(() => isAuthenticated.value)

/** 登录弹窗控制 */
const showLoginPopup = ref(false)

/** 当前选中的项（用于地图可视化） */
const selectedItem = ref<any>(null)

/** 当前方案ID（用于收藏功能） */
const currentPlanId = ref<string | null>(null)
/** 当前方案的已收藏列表（用于isFavorite判断） */
const savedItems = ref<SavedXiaoqu[]>([])

/** 当前页码（从1开始） */
const currentPage = ref(1)

/** 总页数 */
const totalPages = computed(() => {
  if (props.pageSize <= 0) return 1
  return Math.ceil(props.items.length / props.pageSize)
})

/** 当前页数据 */
const currentPageItems = computed(() => {
  if (props.pageSize <= 0) return props.items
  const start = (currentPage.value - 1) * props.pageSize
  return props.items.slice(start, start + props.pageSize)
})

/** 是否有数据 */
const hasData = computed(() => props.items.length > 0)

/** 是否需要分页控件 */
const needPagination = computed(() => props.pageSize > 0 && totalPages.value > 1)

/**
 * 判断项是否已收藏
 * @param {string} itemId — 项的ID
 */
function isFavorite(itemId: string): boolean {
  return savedItems.value.some((s) => s.id === itemId)
}

/**
 * 切换收藏状态
 * @param {any} item — 列表项
 */
async function toggleFavorite(item: any) {
  if (!isLoggedIn.value) {
    showLoginPopup.value = true
    return
  }

  const itemId = item.id
  if (isFavorite(itemId)) {
    await doRemove(item)
  } else {
    await doSave(item)
  }
}

/**
 * 添加收藏
 */
async function doSave(item: any) {
  if (!currentPlanId.value) {
    try {
      const planName =
        props.planType === 'flood'
          ? `浸没分析收藏_${new Date().toLocaleTimeString()}`
          : `选址方案_${new Date().toLocaleTimeString()}`
      const plan = await createPlan(planName, {})
      currentPlanId.value = plan?.id || null
      if (plan) {
        savedItems.value = plan.savedXiaoqu || []
      }
    } catch (error) {
      ElMessage.error('创建收藏方案失败')
      if (import.meta.env.DEV) {
        console.error('[PaginatedListPanel] 创建方案失败:', error)
      }
      return
    }
  }

  if (!currentPlanId.value) return

  try {
    const xiaoquData = toSavedXiaoqu(item)
    const plan = await saveXiaoqu(currentPlanId.value, xiaoquData)
    savedItems.value = plan?.savedXiaoqu || []
    ElMessage.success(`已收藏：${item.name}`)
    emit('favorite-change', { item, isFavorite: true })
  } catch (error) {
    ElMessage.error('收藏失败')
    if (import.meta.env.DEV) {
      console.error('[PaginatedListPanel] 收藏失败:', error)
    }
  }
}

/**
 * 取消收藏
 */
async function doRemove(item: any) {
  if (!currentPlanId.value) {
    ElMessage.warning('未找到收藏方案')
    return
  }
  try {
    const plan = await removeXiaoqu(currentPlanId.value, item.id)
    savedItems.value = plan?.savedXiaoqu || []
    ElMessage.success(`已取消收藏：${item.name}`)
    emit('favorite-change', { item, isFavorite: false })
  } catch (error) {
    ElMessage.error('取消收藏失败')
    if (import.meta.env.DEV) {
      console.error('[PaginatedListPanel] 取消收藏失败:', error)
    }
  }
}

/**
 * 将列表项转换为 SavedXiaoqu 格式
 */
function toSavedXiaoqu(item: any): SavedXiaoqu {
  return {
    id: item.id,
    name: item.name,
    score: item.score ?? 0,
    lng: item.lng ?? item.lon ?? 0,
    lat: item.lat ?? 0,
    breakdown: item.breakdown || {},
  } as SavedXiaoqu
}

/** 跳转到指定页 */
function goToPage(page: number) {
  if (page >= 1 && page <= totalPages.value) {
    currentPage.value = page
  }
}

/**
 * 点击列表项处理
 * 内置地图可视化逻辑：flyTo + 呼吸动画
 * 同时通过emit传参给父组件（用于雷达图等）
 */
function handleItemClick(item: any) {
  selectedItem.value = item

  logger.debug('[PaginatedListPanel] 点击项:', item)
  logger.debug('[PaginatedListPanel] breakdown:', item.breakdown)

  // 兼容 lon/lng 字段（使用 ?? 因为 0 是有效值）
  const lng = item.lng ?? item.lon
  const lat = item.lat ?? item.latitude

  // 规范化数据对象，确保字段一致性
  const normalizedItem = {
    ...item,
    lng,
    lat,
  }

  // 仅在启用地图交互时执行地图操作
  if (props.mapInteraction && lng !== undefined && lat !== undefined) {
    // 设置选中项到mapStore（用于地图标记）
    if (props.planType === 'site-selection') {
      mapStore.setSelectedXiaoqu(normalizedItem)
    }

    // 触发呼吸动画
    startBreathing(lng, lat)

    // 飞行到目标位置（放大到街道级别，比district的8000更近）
    flyTo({ lng, lat }, { height: 1000 })
  }

  // 通过emit传参给父组件（用于雷达图等），传递规范化后的数据
  emit('click-item', normalizedItem)
}

/** 监听数据变化，重置到第一页 */
watch(
  () => props.items.length,
  () => {
    currentPage.value = 1
  },
)

/**
 * 设置当前方案（用于外部初始化）
 */
function setCurrentPlan(planId: string, saved: SavedXiaoqu[]) {
  currentPlanId.value = planId
  savedItems.value = saved || []
}

/**
 * 获取当前方案ID
 */
function getCurrentPlanId(): string | null {
  return currentPlanId.value
}

/**
 * 获取已收藏ID列表
 */
function getSavedIds(): string[] {
  return savedItems.value.map((s) => s.id)
}

defineExpose({
  setCurrentPlan,
  getCurrentPlanId,
  getSavedIds,
  isFavorite,
})
</script>

<template>
  <div class=""paginated-list-panel"">
    <!-- 标题区 -->
    <div class=""panel-header"" v-if=""title"">
      <div class=""header-title"">{{ title }}</div>
    </div>

    <!-- 灰色背景板（包裹列表和分页） -->
    <div class=""gray-container"">
      <!-- 列表内容区 -->
      <div class=""list-content"" v-if=""hasData"">
        <div
          class=""list-item""
          v-for=""(item, index) in currentPageItems""
          :key=""item.id || index""
          @click=""handleItemClick(item)""
        >
          <slot name=""item"" :item=""item"" :index=""index"" />
          <ElButton
            v-if=""showFavorite""
            class=""favorite-btn""
            :type=""isFavorite(item.id) ? 'warning' : 'default'""
            size=""small""
            text
            @click.stop=""toggleFavorite(item)""
          >
            {{ isFavorite(item.id) ? '★' : '☆' }}
          </ElButton>
        </div>
      </div>

      <!-- 无数据提示 -->
      <div class=""no-data-section"" v-else>
        <slot name=""empty"">
          <div class=""no-data-text"">{{ emptyText }}</div>
          <div class=""no-data-hint"" v-if=""emptyHint"">{{ emptyHint }}</div>
        </slot>
      </div>

      <!-- 分页控制区 -->
      <div class=""pagination-section"" v-if=""needPagination"">
        <ElButton size=""small"" :disabled=""currentPage === 1"" @click=""goToPage(1)"">
          &lt;&lt;
        </ElButton>
        <ElButton size=""small"" :disabled=""currentPage === 1"" @click=""goToPage(currentPage - 1)"">
          &lt;
        </ElButton>

        <div class=""page-info"">
          <span class=""current-page"">{{ currentPage }}</span>
          <span class=""page-separator"">/</span>
          <span class=""total-pages"">{{ totalPages }}</span>
        </div>

        <ElButton
          size=""small""
          :disabled=""currentPage === totalPages""
          @click=""goToPage(currentPage + 1)""
        >
          &gt;
        </ElButton>
        <ElButton size=""small"" :disabled=""currentPage === totalPages"" @click=""goToPage(totalPages)"">
          &gt;&gt;
        </ElButton>
      </div>
    </div>
    <ErrorPopup
      v-if=""showLoginPopup""
      :visible=""showLoginPopup""
      mode=""login""
      @close=""showLoginPopup = false""
    />
  </div>
</template>

<style scoped>
.paginated-list-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 0;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 8px;
  box-sizing: border-box;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: v-bind(cell16px);
  flex-shrink: 0;
}

.header-title {
  font-size: v-bind(fontSizeTitle);
  font-weight: 600;
  color: #303133;
}

/* 灰色背景板：距外层panel 0.1cell，距标题 0.1cell */
.gray-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  margin: 0 v-bind(cell8px) v-bind(cell8px) v-bind(cell8px);
  padding: v-bind(cell8px);
  background: #f5f7fa;
  border-radius: 6px;
  box-sizing: border-box;
  overflow: hidden;
  min-height: 0;
}

.list-content {
  display: flex;
  flex-direction: column;
  gap: v-bind(cell8px);
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

/* 单行列表项：不换行 */
.list-item {
  display: flex;
  align-items: center;
  gap: v-bind(cell8px);
  padding: v-bind(cell8px) 10px;
  background: #fff;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
  cursor: pointer;
  transition: background 0.2s;
}

.list-item:hover {
  background: #f0f7ff;
}

.no-data-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: v-bind(cell40px) 20px;
  gap: v-bind(cell8px);
  flex: 1;
}

.no-data-text {
  font-size: v-bind(fontSizeBody);
  color: #303133;
  font-weight: 500;
}

.no-data-hint {
  font-size: v-bind(fontSizeSmall);
  color: #909399;
}

.pagination-section {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: v-bind(cell8px);
  flex-shrink: 0;
}

.page-info {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: v-bind(fontSizeBody);
  color: #303133;
  min-width: 60px;
  justify-content: center;
}

.current-page {
  font-weight: 600;
  color: #409eff;
}

.page-separator {
  color: #909399;
}

.total-pages {
  color: #606266;
}

.pagination-section .el-button {
  min-width: 40px;
  font-size: v-bind(fontSizeSmall);
}

.favorite-btn {
  flex-shrink: 0;
  padding: 0 4px;
  min-width: auto;
}
</style>
```

## src/shared/components/PanelTitle.vue

```vue
<script setup>
/**
 * PanelTitle - 通用面板标题组件
 *
 * 功能：
 * 1. 字号 0.5 cell（40px），铺满标题面板（1 cell 高）
 * 2. 响应式适配，跟随 Cell 单位缩放
 * 3. 所有面板/路由统一使用，只传 title 文本即可
 *
 * Props:
 *   - title: String — 标题文本
 *
 * 使用示例：
 *   <PanelTitle title="北部湾智慧港口平台"" />
 *   <PanelTitle title=""浸没分析报告"" />
 */

import { computed } from 'vue'
import { useGCS } from '@/core/layout/useGCS.js'

const { css, cellPixel } = useGCS()
const { cell8px } = css

/** 标题字号 = 0.4 cell，适配 1 cell 高的标题面板 */
const titleFontSize = computed(() => `${cellPixel.value * 0.4}px`)

defineProps({
  title: {
    type: String,
    default: '',
  },
})
</script>

<template>
  <div class=""panel-title"">
    <span class=""panel-title-text"">{{ title }}</span>
  </div>
</template>

<style scoped>
.panel-title {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: v-bind(cell8px) 0;
}

.panel-title-text {
  font-size: v-bind(titleFontSize);
  font-weight: 600;
  color: #303133;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
```

## src/shared/components/PlanSaveModal.vue

```vue
<script setup>
import { ref, watch } from 'vue''

const props = defineProps({
  visible: Boolean,
  saving: Boolean,
  errorMsg: String,
  initialName: { type: String, default: '''' },
})
// FIX:P3-14: 声明 error 事件，校验失败才能对外反馈
const emit = defineEmits([''close'', ''save'', ''error''])

const planName = ref('''')
const dialogVisible = ref(false)

watch(
  () => props.visible,
  (v) => {
    dialogVisible.value = v
    if (v) planName.value = props.initialName || ''''
  },
)

function handleConfirm() {
  const name = planName.value.trim()
  if (!name) return
  
  // FIX:SEC-004: 方案名称正则校验（仅允许中文、字母、数字、下划线、连字符、空格）
  const nameRegex = /^[\u4e00-\u9fa5a-zA-Z0-9_\-\s]{1,50}$/
  if (!nameRegex.test(name)) {
    emit(''error'', ''方案名称只能包含中文、字母、数字、下划线、连字符和空格，且长度不超过 50 字符'')
    return
  }
  
  emit(''save'', name)
}

function onClose() {
  dialogVisible.value = false
  emit(''close'')
}
</script>

<template>
  <el-dialog v-model="dialogVisible" title="保存方案" width="320px" @close="onClose">
    <el-form class="save-form" @submit.prevent="handleConfirm">
      <el-input v-model="planName" placeholder="请输入方案名称" size="small" maxlength="50" show-word-limit autofocus />
      <div v-if="errorMsg" class="modal-error">{{ errorMsg }}</div>
    </el-form>
    <template #footer>
      <el-button size="small" @click="onClose">取消</el-button>
      <el-button
        size="small"
        type="primary"
        :loading="saving"
        :disabled="!planName.trim()"
        @click="handleConfirm"
      >
        {{ saving ? ''保存中...'' : ''保存'' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.save-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.modal-error {
  color: #e74c3c;
  font-size: 13px;
  margin: 0;
}
</style>
```

## src/shared/composables/useApiRequest.ts

```typescript
import { ref, computed } from 'vue''
import type { Ref, ComputedRef } from ''vue''

// FIX:P3-002: 错误码枚举替代字符串匹配
export enum ErrorCode {
  _TIMEOUT = ''TIMEOUT'',
  _NETWORK_ERROR = ''NETWORK_ERROR'',
  _UNAUTHORIZED = ''UNAUTHORIZED'',
  _SERVER_ERROR = ''SERVER_ERROR'',
  _REQUEST_FAILED = ''REQUEST_FAILED'',
}

export class ApiError extends Error {
  constructor(
    message: string,
    public _code: ErrorCode,
  ) {
    super(message)
    this.name = ''ApiError''
  }
}

const token: Ref<string> = ref('''')
const API_BASE: string = import.meta.env.VITE_API_BASE || ''/api''

function setToken(t: string): void {
  // FIX:SEC-001 修复：移除 localStorage 写入，Token 仅通过 HttpOnly Cookie 存储
  token.value = t
}

function clearToken(): void {
  // FIX:SEC-001 修复：移除 localStorage 清理，Cookie 由后端 clearCookie 清理
  token.value = ''''
}

const isAuthenticated: ComputedRef<boolean> = computed(() => token.value !== '''')

interface RequestOptions {
  method?: string
  body?: string
  headers?: Record<string, string>
  signal?: AbortSignal
}

export function useApiRequest() {
  // FIX:SEC-001: Cookie 通道认证，token 仅由 setToken() 设置
  // 不再调用 loadToken()，避免每次调用时重置 token 状态

  // 泛型函数，支持调用方推导返回值类型
  async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {
      ''Content-Type'': ''application/json'',
      ...options.headers,
    }

    if (token.value !== '''') {
      headers[''Authorization''] = `Bearer ${token.value}`
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    // P1-9: 若外部传入 signal，优先使用；否则使用内部超时 controller
    const signal = options.signal || controller.signal

    try {
      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
        credentials: ''include'', // FIX:SEC-001 修复：自动携带 HttpOnly Cookie
        signal,
      })
      clearTimeout(timeoutId)

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        clearToken()
        const router = (await import(''@/router'')).default
        if (router.currentRoute.value.path !== ''/'') {
          router.push(''/'')
        }
        throw new ApiError(''登录已过期，请重新登录'', ErrorCode.UNAUTHORIZED)
      }

      if (!res.ok) {
        if (res.status === 500) {
          throw new ApiError(data.error || ''服务器错误，请稍后重试'', ErrorCode.SERVER_ERROR)
        }
        throw new ApiError(data.error || `请求失败 HTTP ${res.status}`, ErrorCode.REQUEST_FAILED)
      }

      return data as T
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof Error) {
        if (error.name === ''AbortError'') {
          throw new ApiError(''请求超时，请稍后重试'', ErrorCode.TIMEOUT)
        }
        if (error instanceof TypeError && error.message.includes(''fetch'')) {
          throw new ApiError(''网络异常，请检查网络连接'', ErrorCode.NETWORK_ERROR)
        }
      }
      throw error
    }
  }

  return {
    apiRequest,
    token,
    isAuthenticated,
    setToken,
    clearToken,
  }
}
```

## src/shared/composables/useAuth.ts

```typescript
import { ref, onMounted, onUnmounted } from 'vue''
import type { Ref } from ''vue''
import type { User, AuthResponse } from ''@/types/api''
import { useApiRequest } from ''./useApiRequest''

// FIX:P2-06: 登出时重置全部业务 store，防止跨账号数据残留
import { useSiteSelectionStateStore } from ''@/stores/siteSelectionState''
import { useFloodStateStore } from ''@/stores/floodState''
import { useFloodStore } from ''@/stores/floodStore''
import { usePortImpactStore } from ''@/stores/portImpactStore''
import { useWaterLevelStore } from ''@/stores/waterLevelStore''

/** localStorage 键：持久化用户信息 */
const USER_STORAGE_KEY = ''beibu-gulf-user''

/**
 * 从 localStorage 读取用户信息
 */
function readStoredUser(): User | null {
  if (typeof window === ''undefined'') return null
  try {
    const stored = window.localStorage.getItem(USER_STORAGE_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

/**
 * 将用户信息写入 localStorage
 */
function writeStoredUser(user: User | null): void {
  if (typeof window === ''undefined'') return
  try {
    if (user) {
      window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user))
    } else {
      window.localStorage.removeItem(USER_STORAGE_KEY)
    }
  } catch {
    // 忽略隐私模式等写入失败场景
  }
}

// FIX:004 (架构): 模块级别单例状态，确保所有组件共享同一状态
const user: Ref<User | null> = ref(readStoredUser())
const { apiRequest, token, isAuthenticated, setToken, clearToken } = useApiRequest()

// FIX:313-003: 多标签页状态同步 - 引用计数和全局处理函数
let storageListenerCount = 0

// P1-002-FIX: 认证恢复标志，防止重复调用
let authRestored = false

// FIX:004: 将 checkAuth 提升到模块级别，供 handleStorageChange 调用
async function checkAuth(): Promise<User | null> {
  // FIX:022: 使用显式布尔转换
  if (token.value === '''') return null
  try {
    const data = await apiRequest<{ user: User }>(''/auth/me'')
    // FIX:007: 空值检查
    if (!data || !data.user) {
      throw new Error(''认证响应数据无效'')
    }
    user.value = data.user
    return data.user
  } catch {
    clearToken()
    user.value = null
    writeStoredUser(null)
    return null
  }
}

/**
 * P1-002-FIX: 应用启动时恢复认证状态
 * 通过调用 /api/auth/me 验证 Cookie 中的 Token 是否有效
 */
async function restoreAuth(): Promise<User | null> {
  // 防止重复调用
  if (authRestored) {
    return user.value
  }

  // 如果已有用户信息（从 localStorage 恢复），尝试验证 Token
  if (user.value) {
    try {
      const data = await apiRequest<{ user: User }>(''/auth/me'')
      if (data && data.user) {
        user.value = data.user
        // Token 验证成功，设置一个占位 token 以启用 isAuthenticated
        setToken(''restored-from-cookie'')
        authRestored = true
        return data.user
      }
    } catch {
      // Token 无效，清除用户信息
      clearToken()
      user.value = null
      writeStoredUser(null)
    }
  }

  authRestored = true
  return null
}

/**
 * P2-001-FIX: 多标签页同步 - 监听 beibu-gulf-user 变化
 */
function handleStorageChange(event: StorageEvent): void {
  if (event.key === USER_STORAGE_KEY) {
    if (event.newValue === null) {
      // 其他标签页登出了，当前标签页也要登出
      user.value = null
      clearToken()
      resetBusinessStores() // FIX:P2-06
    } else {
      // 其他标签页登录了，当前标签页也要同步
      try {
        user.value = JSON.parse(event.newValue)
      } catch {
        user.value = null
      }
    }
  }
}

// FIX:P2-06: 登出时重置全部业务 store，防止跨账号数据残留
function resetBusinessStores(): void {
  try {
    useSiteSelectionStateStore().clearState()
    useFloodStateStore().clearState()
    useFloodStore().resetFloodAnalysis()
    usePortImpactStore().resetPortImpact()
    useWaterLevelStore().resetWaterLevel()
  } catch {
    // store 未激活等异常不阻断登出
  }
}

export function useAuth() {
  async function login(username: string, password: string): Promise<User> {
    const data = await apiRequest<AuthResponse>(''/auth/login'', {
      method: ''POST'',
      body: JSON.stringify({ username, password }),
    })
    // FIX:005: 空值检查
    if (!data || !data.token || !data.user) {
      throw new Error(''登录响应数据无效'')
    }
    setToken(data.token)
    user.value = data.user
    writeStoredUser(data.user)
    return data.user
  }

  async function register(username: string, password: string): Promise<User> {
    const data = await apiRequest<AuthResponse>(''/auth/register'', {
      method: ''POST'',
      body: JSON.stringify({ username, password }),
    })
    // FIX:006: 空值检查
    if (!data || !data.token || !data.user) {
      throw new Error(''注册响应数据无效'')
    }
    setToken(data.token)
    user.value = data.user
    writeStoredUser(data.user)
    return data.user
  }

  /**
   * P2-002-FIX: 登出时调用后端API清除Cookie
   */
  async function logout(): Promise<void> {
    try {
      // 调用后端登出接口，清除HttpOnly Cookie
      await apiRequest(''/auth/logout'', { method: ''POST'' })
    } catch (error) {
      // 即使后端调用失败，也清理前端状态
      if (import.meta.env.DEV) {
        console.warn(''登出接口调用失败，但仍清理前端状态:'', error)
      }
    } finally {
      // 清理前端状态
      clearToken()
      user.value = null
      writeStoredUser(null)
      // 重置认证恢复标志，允许下次重新恢复
      authRestored = false
      resetBusinessStores() // FIX:P2-06
    }
  }

  // FIX:313-003: 在组件挂载时添加 storage 事件监听（引用计数）
  onMounted(() => {
    if (typeof window !== ''undefined'' && storageListenerCount === 0) {
      window.addEventListener(''storage'', handleStorageChange)
    }
    storageListenerCount++
  })

  // FIX:313-003: 在组件卸载时移除 storage 事件监听（引用计数）
  onUnmounted(() => {
    storageListenerCount--
    if (typeof window !== ''undefined'' && storageListenerCount === 0) {
      window.removeEventListener(''storage'', handleStorageChange)
    }
  })

  return { user, token, isAuthenticated, login, register, logout, checkAuth, restoreAuth }
}
```

## src/shared/composables/usePlans.ts

```typescript
import { ref } from 'vue''
import type { Ref } from ''vue''
import type { Plan } from ''@/types/plan''
import type { TypeSetting } from ''@/types/facility''
import type { SavedXiaoqu } from ''@/types/xiaoqu''
import { useApiRequest } from ''./useApiRequest''

export function usePlans() {
  const { apiRequest, isAuthenticated } = useApiRequest()
  const saving: Ref<boolean> = ref(false)
  const updating: Ref<boolean> = ref(false)
  const loading: Ref<boolean> = ref(false)
  const deleting: Ref<boolean> = ref(false)

  async function getPlans(): Promise<Plan[]> {
    loading.value = true
    try {
      const data = await apiRequest<Plan[]>(''/plans'')
      // FIX:008: 类型验证
      if (!Array.isArray(data)) {
        throw new Error(''方案列表数据格式无效'')
      }
      return data
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error(''[usePlans] getPlans failed:'', error)
      }
      throw error
    } finally {
      loading.value = false
    }
  }

  async function createPlan(
    name: string,
    typeSettings: Record<string, TypeSetting>,
  ): Promise<Plan> {
    // FIX:108: 保存方案前检查登录状态
    if (!isAuthenticated.value) {
      throw new Error(''请先登录'')
    }
    saving.value = true
    try {
      // FIX:P1-03: flood 方案无 typeSettings，兼容为空对象避免 TypeError
      const settings = typeSettings ?? {}
      const selectedKeys = Object.entries(settings)
        .filter(([, v]) => v.selected)
        .map(([k]) => k)
      // FIX:P1-02: await 使 finally 等待请求完成后再复位，防重复提交生效
      return await apiRequest<Plan>(''/plans'', {
        method: ''POST'',
        body: JSON.stringify({ name, selectedKeys, typeSettings: settings }),
      })
    } finally {
      saving.value = false
    }
  }

  async function deletePlan(id: string): Promise<void> {
    // FIX:108: 删除方案前检查登录状态，与createPlan/updatePlan保持一致
    if (!isAuthenticated.value) {
      throw new Error(''请先登录'')
    }
    deleting.value = true
    try {
      await apiRequest(`/plans/${id}`, { method: ''DELETE'' })
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error(''[usePlans] deletePlan failed:'', error)
      }
      throw error
    } finally {
      deleting.value = false
    }
  }

  async function updatePlan(
    id: string,
    name: string,
    typeSettings: Record<string, TypeSetting>,
  ): Promise<Plan> {
    // FIX:108: 更新方案前检查登录状态，与createPlan保持一致
    if (!isAuthenticated.value) {
      throw new Error(''请先登录'')
    }
    updating.value = true
    try {
      // FIX:P1-03: flood 方案无 typeSettings，兼容为空对象避免 TypeError
      const settings = typeSettings ?? {}
      const selectedKeys = Object.entries(settings)
        .filter(([, v]) => v.selected)
        .map(([k]) => k)
      // FIX:P1-02: await 使 finally 等待请求完成后再复位，防重复提交生效
      return await apiRequest<Plan>(`/plans/${id}`, {
        method: ''PUT'',
        body: JSON.stringify({ name, selectedKeys, typeSettings: settings }),
      })
    } finally {
      updating.value = false
    }
  }

  async function saveXiaoqu(planId: string, xiaoqu: SavedXiaoqu): Promise<Plan> {
    // FIX:108: 保存小区前检查登录状态
    if (!isAuthenticated.value) {
      throw new Error(''请先登录'')
    }
    return apiRequest<Plan>(`/plans/${planId}/xiaoqu`, {
      method: ''POST'',
      body: JSON.stringify({ xiaoqu }),
    })
  }

  async function removeXiaoqu(planId: string, xiaoquId: string): Promise<Plan> {
    return apiRequest<Plan>(`/plans/${planId}/xiaoqu/${xiaoquId}`, {
      method: ''DELETE'',
    })
  }

  return {
    getPlans,
    createPlan,
    updatePlan,
    deletePlan,
    saveXiaoqu,
    removeXiaoqu,
    saving,
    updating,
    loading,
    deleting,
  }
}
```

## src/shared/composables/useScreenActions.js

```javascript
import { computed } from 'vue''
import { useRoute, useRouter } from ''vue-router''
import { useAuth } from ''./useAuth.js''
import { useMapControls } from ''@/core/map/composables/useMapControls.js''

/** 城市坐标配置（北部湾三港） */
const CITY_CENTERS = {
  钦州: { lng: 108.590379, lat: 21.726917, height: 50000, zoom: 11 },
  防城港: { lng: 108.340973, lat: 21.617689, height: 50000, zoom: 11 },
  北海: { lng: 109.130658, lat: 21.418792, height: 50000, zoom: 11 },
}

export function useScreenActions() {
  const route = useRoute()
  const router = useRouter()
  const { user, isAuthenticated } = useAuth()
  const { flyTo } = useMapControls()

  const isHome = computed(() => route.name === ''Home'')

  /**
   * 回到首页
   */
  function goHome() {
    router.push(''/'')
  }

  /**
   * 个人中心 / 返回上一页
   * - 首页：进入个人中心
   * - 非首页：优先返回上一页；历史栈为空时回到首页兜底
   */
  function goProfileOrBack() {
    if (isHome.value) {
      router.push(''/profile'')
      return
    }
    // 历史栈存在上一页则返回，否则回到首页
    if (window.history.state?.back) {
      router.back()
    } else {
      router.push(''/'')
    }
  }

  /**
   * 用户按钮标签：已登录显示用户名，未登录显示"登录"
   */
  const userButtonLabel = computed(() => {
    if (isHome.value) {
      return isAuthenticated.value && user.value?.username ? user.value.username : ''个人中心''
    }
    return ''返回''
  })

  /**
   * 飞行到指定城市中心，同时放大 zoom 显示城市级比例尺
   * @param {string} city - 城市名：钦州 / 防城港 / 北海
   */
  function flyToCity(city) {
    const target = CITY_CENTERS[city]
    if (!target) return
    flyTo({ lng: target.lng, lat: target.lat }, { height: target.height, zoom: target.zoom })
  }

  return {
    isHome,
    goHome,
    goProfileOrBack,
    userButtonLabel,
    flyToCity,
  }
}
```

## src/shared/utils/facilityLabels.js

```javascript
export const FACILITY_LABELS = {
  hospital: '医院'',
  primary_school: ''小学'',
  middle_school: ''中学'',
  park: ''公园'',
  bus_station: ''公交站'',
  mall: ''商场'',
}
```

## src/shared/utils/logger.js

```javascript
const isDev = import.meta.env.DEV

export const logger = {
  debug: (...args) => isDev && console.log(...args),
  info: (...args) => isDev && console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
}
```

## 可视化图表

## src/visualization/charts/BarChart.vue

```vue
<script setup>
import { useChartBase } from './composables/useChartBase''

const props = defineProps({
  title: { type: String, default: ''港口吞吐量对比'' },
  xData: { type: Array, default: () => [''钦州港'', ''北海港'', ''防城港''] },
  series: {
    type: Array,
    default: () => [
      { name: ''2023年'', data: [190, 140, 150] },
      { name: ''2024年'', data: [230, 180, 170] },
    ],
  },
})

const emit = defineEmits([''select''])

const { chartRef } = useChartBase(props, emit, ''bar'', {
  barWidth: ''30%'',
  itemStyle: { borderRadius: [4, 4, 0, 0] },
})
</script>

<template>
  <div ref="chartRef" class="bar-chart"></div>
</template>

<style scoped>
.bar-chart {
  width: 100%;
  height: 100%;
}
</style>
```

## src/visualization/charts/LineChart.vue

```vue
<script setup>
import { useChartBase } from './composables/useChartBase''

const props = defineProps({
  title: { type: String, default: ''港口吞吐量趋势'' },
  xData: { type: Array, default: () => [''2019'', ''2020'', ''2021'', ''2022'', ''2023'', ''2024''] },
  series: {
    type: Array,
    default: () => [
      { name: ''钦州港'', data: [120, 132, 101, 134, 190, 230] },
      { name: ''北海港'', data: [90, 110, 120, 115, 140, 180] },
      { name: ''防城港'', data: [80, 95, 110, 125, 150, 170] },
    ],
  },
  xMin: { type: String, default: '''' },
  xMax: { type: String, default: '''' },
})

const emit = defineEmits([''select''])

const { chartRef } = useChartBase(props, emit, ''line'', {
  smooth: true,
  symbol: ''circle'',
  symbolSize: 6,
  lineStyle: { width: 2 },
  areaStyle: { opacity: 0.15 },
})
</script>

<template>
  <div ref="chartRef" class="line-chart"></div>
</template>

<style scoped>
.line-chart {
  width: 100%;
  height: 100%;
}
</style>
```

## src/visualization/charts/RadarChart.vue

```vue
<script setup lang="ts"">
/**
 * RadarChart - 雷达图面板（简化版）
 *
 * 布局：
 * - 顶部居中：小区名称
 * - 中部：雷达图（左右居中、上下居中，保持原大小）
 * - 底部：综合评分（蓝色字体，可点击）
 *
 * 交互：
 * 1. 点击综合评分 → 在评分上方弹出具体得分（1列6行）
 * 2. 点击其他地方关闭浮窗
 * 3. 点击雷达图轴名称 → 显示该设施POI图层（互斥）
 *
 * FIX:002(架构): 使用 useECharts composable 复用通用图表逻辑
 * FIX:006(架构): 使用 useRadarChart composable 拆分逻辑，减少文件行数
 */

import { ref, watch, nextTick, computed, onBeforeUnmount } from 'vue'
import { useGCS } from '@/core/layout/useGCS.js'
import { useRadarChart } from './composables/useRadarChart'
import RadarScoreTooltip from './components/RadarScoreTooltip.vue'
import type { ScoredXiaoqu } from '@/types/xiaoqu'
import type { FacilityPoint } from '@/types/facility'
import { logger } from '@/shared/utils/logger'

interface Props {
  visible: boolean
  xiaoqu: ScoredXiaoqu | null
  selectedTypes: string[]
  embedded: boolean
  facilityPoi: Record<string, FacilityPoint[]>
  /** 雷达图标题，默认显示""xx小区评分详情图"" */
  title?: string
}

interface Emits {
  (_e: 'close'): void
  (
    _e: 'show-facility-layer',
    _data: {
      type: string
      poiList: FacilityPoint[]
      color: string
      label: string
    },
  ): void
  (_e: 'hide-facility-layer'): void
}

const props = withDefaults(defineProps<Props>(), {
  visible: true,
  xiaoqu: null,
  selectedTypes: () => [],
  embedded: false,
  facilityPoi: () => ({}),
  title: '',
})

/** 动态标题：优先使用传入的title，否则显示""xx小区评分详情图"" */
const displayTitle = computed(() => {
  if (props.title) return props.title
  if (props.xiaoqu?.name) return `${props.xiaoqu.name}评分详情图`
  return '评分详情图'
})

const emit = defineEmits<Emits>()

const chartRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)

const { cellPixel } = useGCS()
const unitPx = computed(() => cellPixel.value * 0.1)

/** 使用 useRadarChart composable 处理雷达图逻辑 */
const {
  tooltipVisible,
  tooltipPosition,
  renderRadar,
  handleScoreClick,
  handleGlobalClick,
  setupResizeObserver,
} = useRadarChart({
  getChartRef: () => chartRef.value,
  getProps: () => props,
  emit,
})

// P1-005-FIX: 标记监听器是否已添加，防止泄漏
let globalClickListenerAdded = false

watch(
  () => tooltipVisible.value,
  (val) => {
    if (val) {
      // P1-005-FIX: 立即添加监听器，不使用 setTimeout 延迟
      if (!globalClickListenerAdded) {
        window.addEventListener('click', handleGlobalClick)
        globalClickListenerAdded = true
      }
    } else {
      window.removeEventListener('click', handleGlobalClick)
      globalClickListenerAdded = false
    }
  },
)

watch(
  () => props.visible,
  (val) => {
    if (val) {
      nextTick(() => renderRadar())
    }
  },
)

watch(
  [() => props.xiaoqu, () => props.selectedTypes, () => props.facilityPoi],
  ([newXiaoqu, newTypes, newPoi]) => {
    logger.debug('[RadarChart] 数据变化:', { xiaoqu: newXiaoqu, types: newTypes, poi: newPoi })
    setupResizeObserver()
    nextTick(() => renderRadar())
  },
  {
    flush: 'post',
  },
)

// P1-005-FIX: 组件卸载时清理全局监听器
onBeforeUnmount(() => {
  window.removeEventListener('click', handleGlobalClick)
  globalClickListenerAdded = false
})
</script>

<template>
  <div ref=""panelRef"" class=""radar-panel"">
    <!-- 顶部：评分详情图标题（与浸没分析标题样式一致：16px/600加粗） -->
    <div class=""radar-title"">{{ displayTitle }}</div>

    <!-- 中部：雷达图容器 -->
    <div class=""radar-container"">
      <div v-if=""xiaoqu"" ref=""chartRef"" class=""radar-chart""></div>
      <div v-else class=""empty-state"">请在结果列表中选择小区查看雷达图</div>
    </div>

    <!-- 底部：综合评分（可点击） -->
    <div v-if=""xiaoqu"" class=""score-text clickable"" @click.stop=""handleScoreClick"">
      综合评分：{{ xiaoqu.score }}
    </div>

    <!-- 具体得分浮窗（使用子组件） -->
    <RadarScoreTooltip
      :visible=""tooltipVisible""
      :xiaoqu=""xiaoqu""
      :selectedTypes=""selectedTypes""
      :position=""tooltipPosition""
    />
  </div>
</template>

<style scoped>
.radar-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 0;
  box-sizing: border-box;
  position: relative;
}

/* 标题：与浸没分析标题样式一致（16px/600加粗/不顶格） */
.radar-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: calc(4 * v-bind(unitPx)) 0 calc(2 * v-bind(unitPx)) 0;
}

/* 雷达图容器：flex 占满剩余空间，内部用 absolute 确保 ECharts 有确定尺寸 */
.radar-container {
  flex: 1;
  min-height: 0;
  position: relative;
}

.radar-chart {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

.empty-state {
  color: #999;
  font-size: 13px;
  text-align: center;
}

/* 综合评分：距雷达图 0.2 cell，距 panel 底部 0.2 cell */
.score-text {
  color: #409eff;
  font-weight: 500;
  margin: 0;
  font-size: 14px;
  text-align: center;
  margin-top: calc(2 * v-bind(unitPx));
  margin-bottom: calc(2 * v-bind(unitPx));
}

.score-text.clickable {
  cursor: pointer;
  transition: color 0.2s;
}

.score-text.clickable:hover {
  color: #66b1ff;
}
</style>
```

## src/visualization/charts/components/RadarScoreTooltip.vue

```vue
<script setup>
/**
 * RadarScoreTooltip - 雷达图得分弹窗组件
 * 
 * 职责：显示雷达图的具体得分（1列6行网格布局）
 * 解决 FIX:006(架构)：拆分RadarChart组件
 */

import { computed } from 'vue''
import { FACILITY_LABELS } from ''@/shared/utils/facilityLabels''
import { FACILITY_CONFIG } from ''@/business/site-selection/composables/useFacilities''
import { useGCS } from ''@/core/layout/useGCS.js''

defineProps({
  visible: { type: Boolean, default: false },
  xiaoqu: { type: Object, default: null },
  selectedTypes: { type: Array, default: () => [] },
  position: { type: Object, default: () => ({ left: 0, top: 0 }) },
})

const { cellPixel } = useGCS()

/** 弹窗尺寸：2×3 cell */
const tooltipW = computed(() => cellPixel.value * 2)
const tooltipH = computed(() => cellPixel.value * 3)
const unitPx = computed(() => cellPixel.value * 0.1)

/** 获取设施颜色 */
function getFacilityColor(key) {
  return FACILITY_CONFIG[key]?.color || ''#666''
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible && xiaoqu && selectedTypes.length > 0"
      class="radar-tooltip"
      :style="{
        left: position.left + ''px'',
        top: position.top + ''px'',
        width: tooltipW + ''px'',
        height: tooltipH + ''px'',
      }"
    >
      <div class="tooltip-grid">
        <div
          v-for="key in selectedTypes"
          :key="key"
          class="tooltip-item"
          :style="{ color: getFacilityColor(key) }"
        >
          <span class="tooltip-label">{{ FACILITY_LABELS[key] }}</span>
          <span class="tooltip-value">{{ xiaoqu.breakdown?.[key] ?? 0 }}分</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.radar-tooltip {
  position: fixed;
  z-index: 1000;
  background: rgba(255, 255, 255, 0.98);
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  box-sizing: border-box;
}

.tooltip-grid {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: repeat(6, 1fr);
  width: 100%;
  height: 100%;
}

.tooltip-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 0 calc(1 * v-bind(unitPx));
  font-size: 15px;
  border-bottom: 1px solid #f0f0f0;
}

.tooltip-item:last-child {
  border-bottom: none;
}

.tooltip-label {
  font-weight: 500;
  font-size: 14px;
}

.tooltip-value {
  font-weight: 600;
  font-size: 15px;
}
</style>
```

## src/visualization/charts/composables/useChartBase.js

```javascript
import { useECharts } from '@/visualization/composables/useECharts''

export function useChartBase(props, emit, chartType, seriesConfig) {
  function handleClick(params) {
    if (params.dataIndex == null) return
    emit(''select'', params.dataIndex)
  }

  /**
   * P0-01-FIX: option 必须在每次调用时现取 props 构建。
   * 修复前 baseOption 为 setup 时的一次性快照，导致 props 更新后图表永不刷新。
   * 注意：watch 为浅监听，父组件更新数据时必须替换数组/对象引用（不可变更新），
   * 不要原地 push/splice，否则不会触发更新。
   */
  function buildOption() {
    const dataLen = (props.xData || []).length
    const dense = dataLen > 24 // 月粒度超过 24 个点自动间隔
    return {
      backgroundColor: ''transparent'',
      grid: { top: 40, right: 16, bottom: 40, left: 40 },
      title: {
        text: props.title,
        left: ''center'',
        textStyle: { color: ''#303133'', fontSize: 16, fontWeight: 600 },
      },
      tooltip: { trigger: ''axis'' },
      legend: {
        bottom: 0,
        textStyle: { color: ''#666'', fontSize: 10 },
        itemWidth: 10,
        itemHeight: 6,
      },
      xAxis: {
        type: ''category'',
        data: props.xData || [],
        axisLine: { lineStyle: { color: ''#ddd'' } },
        axisLabel: {
          color: ''#666'',
          fontSize: 10,
          ...(dense ? { interval: 2, rotate: 30 } : {}),
        },
        ...(props.xMin ? { min: props.xMin } : {}),
        ...(props.xMax ? { max: props.xMax } : {}),
      },
      yAxis: {
        type: ''value'',
        splitLine: { lineStyle: { color: ''#eee'' } },
        axisLabel: { color: ''#666'', fontSize: 10 },
        ...(props.yUnit ? { name: props.yUnit, nameTextStyle: { fontSize: 10, color: ''#999'' } } : {}),
      },
      animationDuration: 300,
      animationEasing: ''linear'',
      series: (props.series || []).map((s) => ({
        name: s.name,
        type: chartType,
        data: s.data || [],
        ...seriesConfig,
      })),
    }
  }

  return useECharts({
    getOption: buildOption,
    watchSources: [() => props.title, () => props.xData, () => props.series, () => props.xMin, () => props.xMax],
    onClick: handleClick,
  })
}
```

## src/visualization/charts/composables/useRadarChart.js

```javascript
import { ref, nextTick, onMounted, onBeforeUnmount } from 'vue''
import * as echarts from ''echarts/core''
import { RadarChart as EChartsRadarChart } from ''echarts/charts''
import { TooltipComponent } from ''echarts/components''
import { CanvasRenderer } from ''echarts/renderers''
import { FACILITY_LABELS } from ''@/shared/utils/facilityLabels''
import { FACILITY_CONFIG } from ''@/business/site-selection/composables/facilityConfig''

// 注册 ECharts 组件
echarts.use([EChartsRadarChart, TooltipComponent, CanvasRenderer])

export function useRadarChart({ getChartRef, getProps, emit }) {
  let chartInstance = null
  let resizeObserver = null
  let isRendering = false

  /** 浮窗状态 */
  const tooltipVisible = ref(false)
  const tooltipPosition = ref({ left: 0, top: 0 })

  /** 当前选中的设施类型 */
  const activeFacilityType = ref(null)

  /** 获取设施颜色 */
  function getFacilityColor(key) {
    return FACILITY_CONFIG[key]?.color || ''#666''
  }

  /** 渲染雷达图 */
  function renderRadar() {
    const chartRef = getChartRef()
    const props = getProps()
    
    if (!chartRef || isRendering) return
    
    const w = chartRef.clientWidth
    const h = chartRef.clientHeight
    
    // P1-006-FIX: 容器尺寸不足时重试，最多重试10次（1秒）
    if (w < 10 || h < 10) {
      const retryCount = (chartRef._radarRetryCount || 0) + 1
      if (retryCount > 10) {
        if (import.meta.env.DEV) {
          console.warn(''雷达图容器尺寸持续不足，放弃渲染'')
        }
        return
      }
      chartRef._radarRetryCount = retryCount
      setTimeout(() => renderRadar(), 100)
      return
    }
    // 重置重试计数
    if (chartRef._radarRetryCount) {
      chartRef._radarRetryCount = 0
    }
    
    isRendering = true
    
    if (!chartInstance) {
      chartInstance = echarts.init(chartRef)
      
      chartInstance.on(''click'', (params) => {
        if (params.componentType === ''radar'' && params.name) {
          const key = props.selectedTypes.find(
            (k) => FACILITY_LABELS[k] === params.name
          )
          if (key) {
            handleFacilityClick(key)
          }
        }
      })
    }

    const indicators = props.selectedTypes.map((key) => ({
      name: FACILITY_LABELS[key] || key,
      max: 100,
    }))
    
    const values = props.selectedTypes.map(
      (key) => props.xiaoqu?.breakdown?.[key] ?? 0
    )
    
    const name = props.xiaoqu?.name || ''''

    chartInstance.setOption({
      backgroundColor: ''transparent'',
      tooltip: { show: false },
      radar: {
        indicator: indicators,
        radius: ''75%'',
        center: [''50%'', ''50%''],
        axisName: {
          color: ''#409eff'',
          fontSize: 12,
          fontWeight: 500,
          cursor: ''pointer'',
        },
        splitLine: { lineStyle: { color: ''#eee'' } },
        splitArea: {
          areaStyle: {
            color: [''rgba(255,255,255,0.1)'', ''rgba(255,255,255,0.3)''],
          },
        },
        axisLine: { lineStyle: { color: ''#ddd'' } },
      },
      series: [
        {
          type: ''radar'',
          symbolSize: 6,
          lineStyle: { width: 2, color: ''#409eff'' },
          itemStyle: { color: ''#409eff'' },
          data: [
            {
              value: values,
              name: name,
              areaStyle: { opacity: 0.3, color: ''#409eff'' },
            },
          ],
        },
      ],
    })

    isRendering = false
  }

  /** 点击综合评分 */
  function handleScoreClick() {
    if (tooltipVisible.value) {
      tooltipVisible.value = false
      return
    }

    const scoreEl = document.querySelector(''.score-text'')
    if (scoreEl) {
      const rect = scoreEl.getBoundingClientRect()
      let left = rect.left + rect.width / 2 - 160
      let top = rect.top - 240 - 8

      const viewportW = window.innerWidth
      const viewportH = window.innerHeight

      if (left < 10) left = 10
      if (left + 320 > viewportW - 10) left = viewportW - 320 - 10

      if (top < 10) {
        top = rect.bottom + 8
      }

      if (top + 240 > viewportH - 10) {
        top = viewportH - 240 - 10
      }

      tooltipPosition.value = { left, top }
      tooltipVisible.value = true
    }
  }

  /** 点击其他地方关闭浮窗 */
  function handleGlobalClick(e) {
    const tooltipEl = document.querySelector(''.radar-tooltip'')
    const scoreEl = document.querySelector(''.score-text'')

    if (
      tooltipVisible.value &&
      tooltipEl &&
      !tooltipEl.contains(e.target) &&
      !scoreEl?.contains(e.target)
    ) {
      tooltipVisible.value = false
    }
  }

  /** 点击设施名称（显示 POI 图层） */
  function handleFacilityClick(key) {
    const props = getProps()
    
    if (activeFacilityType.value === key) {
      activeFacilityType.value = null
      emit(''hide-facility-layer'')
      return
    }

    activeFacilityType.value = key
    emit(''show-facility-layer'', {
      type: key,
      poiList: props.facilityPoi[key] || [],
      color: getFacilityColor(key),
      label: FACILITY_LABELS[key],
    })
  }

  function handleResize() {
    chartInstance?.resize()
  }

  /** 设置 ResizeObserver */
  function setupResizeObserver() {
    const chartRef = getChartRef()
    
    resizeObserver?.disconnect()
    if (chartRef) {
      resizeObserver = new ResizeObserver(() => {
        nextTick(() => renderRadar())
      })
      resizeObserver.observe(chartRef)
    }
  }

  onMounted(() => {
    window.addEventListener(''resize'', handleResize)
    setupResizeObserver()
  })

  onBeforeUnmount(() => {
    chartInstance?.dispose()
    chartInstance = null
    window.removeEventListener(''click'', handleGlobalClick)
    window.removeEventListener(''resize'', handleResize)
    resizeObserver?.disconnect()
  })

  return {
    tooltipVisible,
    tooltipPosition,
    activeFacilityType,
    renderRadar,
    handleScoreClick,
    handleGlobalClick,
    setupResizeObserver,
  }
}
```

## src/visualization/composables/useECharts.js

```javascript
import { ref, onMounted, onUnmounted, watch } from 'vue''
import * as echarts from ''echarts/core''

// FIX:P3-09: 注册必需组件（解决 "Component grid is used but not imported" 错误）
import { 
  GridComponent, 
  TitleComponent, 
  LegendComponent, 
  TooltipComponent 
} from ''echarts/components''
import { LineChart, BarChart } from ''echarts/charts''
import { CanvasRenderer } from ''echarts/renderers''

echarts.use([
  GridComponent,
  TitleComponent,
  LegendComponent,
  TooltipComponent,
  LineChart,
  BarChart,
  CanvasRenderer,
])

export function useECharts({ getOption, watchSources = [], onClick = null }) {
  const chartRef = ref(null)
  let chartInstance = null

  /**
   * 初始化图表
   */
  function initChart() {
    if (!chartRef.value) return

    chartInstance = echarts.init(chartRef.value)
    updateChart()
    
    if (onClick) {
      chartInstance.on(''click'', onClick)
    }

    window.addEventListener(''resize'', handleResize)
  }

  /**
   * 更新图表配置
   * 使用增量更新模式：notMerge=false 保留现有配置，lazyUpdate=true 延迟渲染提升性能
   */
  function updateChart() {
    if (!chartInstance) return
    const option = getOption()
    chartInstance.setOption(option, { notMerge: false, lazyUpdate: true })
  }

  /**
   * 处理窗口大小变化
   */
  function handleResize() {
    chartInstance?.resize()
  }

  /**
   * 销毁图表实例
   */
  function disposeChart() {
    window.removeEventListener(''resize'', handleResize)
    if (onClick && chartInstance) {
      chartInstance.off(''click'', onClick)
    }
    chartInstance?.dispose()
    chartInstance = null
  }

  onMounted(initChart)
  onUnmounted(disposeChart)

  // 监听数据源变化
  if (watchSources.length > 0) {
    watch(watchSources, updateChart)
  }

  return {
    chartRef,
    updateChart,
    getInstance: () => chartInstance,
  }
}
```

## src/visualization/panels/PortInfoPanel.vue

```vue
<script setup>
/**
 * PortInfoPanel - 港口信息展示面板
 *
 * 功能：显示选中港口的详细信息（地址、电话、类型、经纬度）
 *
 * 布局：绝对定位，右上角
 */
import { computed } from 'vue''
import { useGCS } from ''@/core/layout/useGCS.js''

defineProps({
  selectedPort: Object,
})

const { cellPixel } = useGCS()
const unitPx = computed(() => cellPixel.value * 0.1)
</script>

<template>
  <div class="port-info-panel" v-if="selectedPort">
    <h2>{{ selectedPort.name }}</h2>
    <div class="info-item">
      <span>📍 地址：</span>
      <span>{{ selectedPort.address || ''暂无'' }}</span>
    </div>
    <div class="info-item">
      <span>📞 电话：</span>
      <span>{{ selectedPort.phone || ''暂无'' }}</span>
    </div>
    <div class="info-item">
      <span>🏷️ 类型：</span>
      <span>{{ selectedPort.type || ''未知'' }}</span>
    </div>
    <div class="info-item">
      <span>🌐 经纬度：</span>
      <span>{{ selectedPort.lon }}, {{ selectedPort.lat }}</span>
    </div>
  </div>
</template>

<style scoped>
.port-info-panel {
  position: absolute;
  top: calc(8.5 * v-bind(unitPx));
  right: calc(1.5 * v-bind(unitPx));
  width: calc(35 * v-bind(unitPx));
  z-index: 55;
  background: rgba(255, 255, 255, 0.95);
  border-radius: calc(1.25 * v-bind(unitPx));
  box-shadow: 0 calc(0.5 * v-bind(unitPx)) calc(2.25 * v-bind(unitPx)) rgba(0, 0, 0, 0.2);
  padding: calc(1.5 * v-bind(unitPx));
  max-height: 80vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: v-bind(unitPx);
}
.port-info-panel h2 {
  margin: 0;
  font-size: calc(2.25 * v-bind(unitPx));
  color: #333;
}
.info-item {
  font-size: calc(1.75 * v-bind(unitPx));
  color: #444;
  line-height: 1.4;
}
</style>
```

## 服务层与工具

## src/services/mapDataService.js

```javascript
import { MAP_CONFIG } from '@/core/config/map''

// FIX:P3-06: 缓存加 TTL + in-flight Promise 去重
const CACHE_TTL = 5 * 60 * 1000
const dataCache = new Map() // url -> { data, cachedAt }
const pendingCache = new Map() // url -> Promise

async function fetchData(url) {
  // TTL 检查
  const hit = dataCache.get(url)
  if (hit && Date.now() - hit.cachedAt < CACHE_TTL) {
    return hit.data
  }
  // in-flight 去重：同 URL 已有请求在途，共享同一个 Promise
  if (pendingCache.has(url)) {
    return pendingCache.get(url)
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)

  const p = fetch(url, { signal: controller.signal })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`请求失败: ${url}, HTTP ${response.status}`)
      }
      return response.json()
    })
    .then((data) => {
      dataCache.set(url, { data, cachedAt: Date.now() })
      pendingCache.delete(url)
      return data
    })
    .catch((err) => {
      pendingCache.delete(url)
      throw err
    })
    .finally(() => clearTimeout(timeoutId))

  pendingCache.set(url, p)
  return p
}

export const mapDataService = {
  async getPorts() {
    try {
      const data = await fetchData(MAP_CONFIG.DATA_PATHS.ports)
      if (!Array.isArray(data)) {
        // FIX:013: 提供更具体的错误信息
        throw new Error(`港口数据格式异常：期望数组类型，实际收到 ${typeof data}`)
      }
      return data
    } catch (error) {
      // FIX:013: 区分不同类型的错误
      if (error.message.includes(''格式异常'')) {
        console.error(''港口数据格式验证失败:'', error)
        throw new Error(''港口数据格式不正确，请联系管理员'', { cause: error })
      }
      console.error(''加载港口数据失败:'', error)
      throw error
    }
  },

  async getBoundary() {
    try {
      const data = await fetchData(MAP_CONFIG.DATA_PATHS.boundary)
      // FIX:014: 更严格的GeoJSON格式验证
      if (!data || typeof data !== ''object'') {
        throw new Error(''边界数据为空或格式无效'')
      }
      if (!data.features || !Array.isArray(data.features)) {
        throw new Error(''边界数据缺少features数组或格式不正确'')
      }
      // FIX:014: 验证每个feature的基本结构
      const validFeatures = data.features.filter((f, index) => {
        if (!f || !f.geometry || !f.geometry.coordinates) {
          if (import.meta.env.DEV) {
            console.warn(`边界数据第${index}个feature结构无效:`, f)
          }
          return false
        }
        return true
      })
      if (validFeatures.length === 0) {
        throw new Error(''边界数据中无有效的feature'')
      }
      return { ...data, features: validFeatures }
    } catch (error) {
      // FIX:014: 区分格式错误和加载错误
      if (error.message.includes(''格式'') || error.message.includes(''feature'')) {
        console.error(''边界数据格式验证失败:'', error)
        throw new Error(''边界数据格式不正确，请联系管理员'', { cause: error })
      }
      console.error(''加载边界数据失败:'', error)
      throw error
    }
  },

  clearCache() {
    dataCache.clear()
    pendingCache.clear()
  },

  getCacheStatus() {
    return {
      ports: dataCache.has(MAP_CONFIG.DATA_PATHS.ports),
      boundary: dataCache.has(MAP_CONFIG.DATA_PATHS.boundary),
    }
  },
}
```

## src/types/analysis.ts

```typescript
import type { Feature, Geometry } from 'geojson''
import type { FacilityType, TypeSetting } from ''./facility''
import type { ScoredXiaoqu } from ''./xiaoqu''

// 重新导出类型，方便其他模块引用
export type { FacilityType, TypeSetting } from ''./facility''
export type { ScoredXiaoqu } from ''./xiaoqu''

// 分析请求参数（前端 → 后端）
export interface AnalysisParams {
  selectedKeys: FacilityType[]
  typeSettings: Record<string, TypeSetting>
  weights?: Record<string, number>
}

// 分析结果（后端 → 前端）
// 注意：coverage 可能是 Polygon 或 MultiPolygon，turf.union 返回不确定
// 这里用 Feature<Geometry> 而不是 Feature<Polygon | MultiPolygon>
// 因为 turf 7 的 union 可能返回 GeometryCollection
export interface AnalysisResult {
  error: string | null
  coverage: Feature<Geometry> | null
  matchedXiaoqu: ScoredXiaoqu[]
  facilityPoi?: Record<string, import(''./facility'').FacilityPoint[]>
  selectedTypes?: string[]
}

// 分析状态（前端组件内部使用）
export interface AnalysisState {
  calculating: boolean
  calcError: string
  result: AnalysisResult | null
}

// 重导出 FacilityPoint 方便引用
export type { FacilityPoint } from ''./facility''
```

## src/types/api.ts

```typescript
import type { Plan } from './plan''
import type { AnalysisResult } from ''./analysis''

// 认证相关
export interface User {
  id: string
  username: string
  createdAt: string
}

export interface AuthResponse {
  token: string
  user: User
}

// API 错误响应
export interface ApiError {
  error: string
}

// 方案列表响应
export type PlansResponse = Plan[]

// 分析 API 响应（就是 AnalysisResult）
export type AnalysisApiResponse = AnalysisResult
```

## src/types/facility.ts

```typescript
export type FacilityType =
  | 'hospital''
  | ''primary_school''
  | ''middle_school''
  | ''park''
  | ''bus_station''
  | ''mall''

// 设施配置（来自 useFacilities.js 的 FACILITY_CONFIG）
export interface FacilityConfig {
  label: string
  color: string
  defaultRadius: number
}

// 设施点（POI，来自 server/data/qz_*.json）
export interface FacilityPoint {
  id?: string
  name: string
  lng: number
  lat: number
}

// 设施类型设置（因子面板中每个设施的状态）
export interface TypeSetting {
  selected: boolean
  importance: number
  defaultRadius: number
  radius?: number
}

// 设施配置映射
export type FacilityConfigMap = Record<FacilityType, FacilityConfig>
```

## src/types/index.ts

```typescript
export * from './facility''
export * from ''./xiaoqu''
export * from ''./analysis''
export * from ''./plan''
export * from ''./api''
export * from ''./map''
```

## src/types/map.ts

```typescript
// 注意：港口数据用的是 lon，不是 lng（历史数据问题）
export interface Port {
  id: string
  name: string
  address: string
  lon: number
  lat: number
  description?: string
}

// 图层条目（map store 的 layerCatalog 元素）
export interface LayerEntry {
  key: string
  label: string
  visible: boolean
  category: 'base'' | ''business''
  show: Array<() => void>
  hide: Array<() => void>
}

// 面板名称
export type PanelName = ''none'' | ''port-info'' | ''xiaoqu-detail'' | string

// 地图类型
export type MapType = ''2d'' | ''3d''
```

## src/types/plan.ts

```typescript
import type { TypeSetting } from './facility''
import type { SavedXiaoqu } from ''./xiaoqu''

// 重新导出类型，方便其他模块引用
export type { SavedXiaoqu } from ''./xiaoqu''

// 方案（后端 plans.json 中的一条记录）
export interface Plan {
  id: string
  userId: string
  name: string
  selectedKeys: string[] // 不强约束 FacilityType[]，因为旧数据可能有不一致
  typeSettings: Record<string, TypeSetting>
  savedXiaoqu: SavedXiaoqu[]
  createdAt: string
  updatedAt: string
  /** 业务类型：''flood'' | ''site-selection'' | undefined（旧数据无此字段） */
  businessType?: string
  /** 浸没方案水位（仅 flood 类型有值） */
  waterLevel?: number
  /** 浸没方案统计数据（仅 flood 类型有值） */
  floodStatistics?: any
  /** 浸没方案特征数据（仅 flood 类型有值） */
  floodFeatures?: any[]
  /** 浸没方案受影响设施（仅 flood 类型有值） */
  affectedFacilities?: any[]
  /** 浸没方案总损失（仅 flood 类型有值） */
  totalLoss?: number
  /** 浸没方案风险等级（仅 flood 类型有值，FIX:P2-03） */
  floodRiskLevel?: string
}

// 创建方案参数
export interface CreatePlanParams {
  name: string
  selectedKeys: string[]
  typeSettings: Record<string, TypeSetting>
}

// 更新方案参数
export interface UpdatePlanParams {
  name?: string
  selectedKeys?: string[]
  typeSettings?: Record<string, TypeSetting>
}
```

## src/types/xiaoqu.ts

```typescript
import type { FacilityType, TypeSetting } from './facility''

// 基础小区（来自 server/data/xiaoqu.json）
export interface Xiaoqu {
  id: string
  name: string
  lng: number
  lat: number
}

// 评分后的小区（分析结果，后端返回）
export interface ScoredXiaoqu extends Xiaoqu {
  score: number
  breakdown: Record<string, number> // key 是 FacilityType，但不强约束避免 turf 计算报错
}

// 已保存的小区（方案中，持久化到 plans.json）
export interface SavedXiaoqu extends ScoredXiaoqu {
  savedAt: string
  selectionCriteria?: {
    selectedTypes: FacilityType[]
    typeSettings: Record<string, TypeSetting>
  }
}
```

## src/views/HomePage.vue

```vue
<script setup>
/**
 * HomePage - 首页
 *
 * 职责：作为 Layout Base 的承载页面，渲染 GCS 四象限布局。
 * Phase 3-A 已接入 AppLayout；当前仅保留 InfoPanel 用于展示选中港口信息。
 */

import AppLayout from '@/core/layout/AppLayout.vue''
import PortInfoPanel from ''@/visualization/panels/PortInfoPanel.vue''
import { useMapStore } from ''@/stores/map''

const mapStore = useMapStore()
</script>

<template>
  <div class="home-page">
    <AppLayout />
    <PortInfoPanel v-if="mapStore.selectedPort" :selectedPort="mapStore.selectedPort" />
  </div>
</template>

<style scoped>
.home-page {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.home-page :deep(.info-panel) {
  pointer-events: auto;
}
</style>
```

## src/views/ProfilePage.vue

```vue
<script setup lang="ts"">
/**
 * ProfilePage - 个人中心（用户工作台）
 *
 * 继承 AppLayout 布局基座：
 * - 左侧：默认可视化面板（折线图 + 柱状图）
 * - 右侧：单个 4×8 Panel，放置 LoginPanel + 收藏夹
 *
 * 功能：
 * 1. 登录/注册/退出
 * 2. 收藏夹：按方案分组显示已收藏的小区/设施
 * 3. 方案重命名、删除、加载
 *
 * 布局规格：
 * - 右侧 Panel 4×8 Cell，anchor=top-right, offset-y=1.25
 * - 上半部分：LoginPanel
 * - 下半部分：收藏夹列表
 */

import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { inject } from 'vue'
import { ElMessageBox } from 'element-plus'
import AppLayout from '@/core/layout/AppLayout.vue'
import GcsPanel from '@/core/layout/components/GcsPanel.vue'
import LoginPanel from '@/shared/components/LoginPanel.vue'
import PlanSaveModal from '@/shared/components/PlanSaveModal.vue'
import PaginatedListPanel from '@/shared/components/PaginatedListPanel.vue'
import { usePlans } from '@/shared/composables/usePlans'
import { useAuth } from '@/shared/composables/useAuth'
import { useFloodStateStore } from '@/stores/floodState'
import type { Plan } from '@/types/plan'
import type { SavedXiaoqu } from '@/types/xiaoqu'

const router = useRouter()
const { updatePlan, getPlans, deletePlan, loading: plansLoading, deleting: plansDeleting } = usePlans()
const { user } = useAuth()
const floodStateStore = useFloodStateStore()

const restorePlanData = inject('restorePlanData', ref(null))
const editingPlan = inject('editingPlan', ref(null))

const showSaveModal = ref(false)
const editingNamePlan = ref<Plan | null>(null)
const saveError = ref('')
const savingName = ref(false)

/** 方案列表（含收藏内容） */
const plansError = ref('')
const plansList = ref<Plan[]>([])

/** 当前展开的方案ID */
const expandedPlanId = ref<string | null>(null)

/**
 * 加载方案列表（含已收藏小区）
 */
async function loadPlans() {
  if (!user.value) return

  plansError.value = ''
  try {
    plansList.value = await getPlans()
  } catch (error) {
    plansError.value = error.message || '方案列表加载失败，请稍后重试'
    if (import.meta.env.DEV) {
      console.error('[ProfilePage] 加载方案列表失败:', error)
    }
  }
}

/**
 * 删除方案
 */
async function handleDeletePlan(plan: Plan) {
  try {
    await ElMessageBox.confirm(`确定要删除方案""${plan.name}""吗？`, '删除确认', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }

  plansError.value = ''
  try {
    await deletePlan(plan.id)
    if (expandedPlanId.value === plan.id) {
      expandedPlanId.value = null
    }
    await loadPlans()
  } catch (error) {
    plansError.value = error.message || '删除失败，请稍后重试'
    if (import.meta.env.DEV) {
      console.error('[ProfilePage] 删除方案失败:', error)
    }
  }
}

/**
 * 切换方案展开/收起
 */
function togglePlan(planId: string) {
  expandedPlanId.value = expandedPlanId.value === planId ? null : planId
}

/**
 * 加载方案到对应业务页面
 * 根据 businessType 路由到选址分析或浸没分析
 */
function handleLoadPlan(plan: Plan) {
  if (plan.businessType === 'flood') {
    loadFloodPlan(plan)
    return
  }
  restorePlanData.value = plan.typeSettings || {}
  editingPlan.value = plan
  router.push('/site-selection')
}

/**
 * 加载浸没分析方案：保存状态到 floodStateStore 后跳转
 */
function loadFloodPlan(plan: Plan) {
  floodStateStore.saveState({
    waterLevel: plan.waterLevel || 0,
    floodStatistics: plan.floodStatistics,
    floodFeatures: plan.floodFeatures,
    floodRiskLevel: plan.floodRiskLevel, // FIX:P2-03: 补传风险等级
    affectedFacilities: plan.affectedFacilities,
    totalLoss: plan.totalLoss,
  })
  router.push('/heatmap')
}

/**
 * 编辑方案名称
 */
function handleEditPlan(plan: Plan) {
  editingNamePlan.value = plan
  saveError.value = ''
  showSaveModal.value = true
}

/**
 * 保存方案名称
 */
async function handleSaveName(name: string) {
  if (!editingNamePlan.value) return
  savingName.value = true
  saveError.value = ''
  try {
    await updatePlan(editingNamePlan.value.id, name.trim(), editingNamePlan.value.typeSettings)
    showSaveModal.value = false
    await loadPlans()
  } catch (e) {
    saveError.value = e.message || '重命名失败'
  } finally {
    savingName.value = false
  }
}

/**
 * 收藏状态变化后重新加载
 */
async function handleFavoriteChange() {
  await loadPlans()
}

/**
 * 判断方案是否包含选址分析类型的小区（score > 0）
 */
function getSiteXiaoqu(plan: Plan): SavedXiaoqu[] {
  return plan.savedXiaoqu?.filter((xq) => xq.score > 0) || []
}

/**
 * 判断方案是否包含浸没分析类型的设施（score === 0）
 */
function getFloodFacilities(plan: Plan): SavedXiaoqu[] {
  return plan.savedXiaoqu?.filter((xq) => !xq.score || xq.score === 0) || []
}

// 监听用户登录状态，自动加载方案列表
watch(
  () => user.value,
  (newUser) => {
    if (newUser) {
      loadPlans()
    } else {
      plansList.value = []
      plansError.value = ''
      expandedPlanId.value = null
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class=""profile-page"">
    <AppLayout>
      <!-- 左侧：不传 slot，使用 AppLayout 默认可视化面板（折线图 + 柱状图） -->

      <!-- 右侧：单个 4×8 Panel -->
      <template #right>
        <GcsPanel :w=""4"" :h=""8"" anchor=""top-right"" :offset-x=""0"" :offset-y=""1.25"">
          <div class=""profile-content"">
            <!-- 顶部：登录面板（用户信息区域） -->
            <LoginPanel />

            <!-- 中部：收藏夹内容 -->
            <div class=""favorites-container"">
              <!-- 错误提示 -->
              <div v-if=""plansError"" class=""plans-error"">
                {{ plansError }}
              </div>

              <!-- 加载状态 -->
              <div v-if=""plansLoading"" class=""plans-loading"">
                加载中...
              </div>

              <!-- 收藏夹标题 -->
              <div v-if=""user && plansList.length > 0"" class=""favorites-header"">
                <span class=""favorites-title"">我的收藏</span>
                <span class=""favorites-count"">{{ plansList.length }}个方案</span>
              </div>

              <!-- 方案列表（可展开查看收藏内容） -->
              <div v-if=""user && plansList.length > 0"" class=""plans-list"">
                <div v-for=""plan in plansList"" :key=""plan.id"" class=""plan-group"">
                  <!-- 方案头部 -->
                  <div class=""plan-header"" @click=""togglePlan(plan.id)"">
                    <span class=""plan-toggle"">{{ expandedPlanId === plan.id ? '▼' : '▶' }}</span>
                    <span class=""plan-name"">{{ plan.name }}</span>
                    <span class=""plan-count"">{{ plan.savedXiaoqu?.length || 0 }}项</span>
                  </div>

                  <!-- 展开内容：操作按钮 + 收藏列表 -->
                  <div v-if=""expandedPlanId === plan.id"" class=""plan-detail"">
                    <!-- 操作按钮 -->
                    <div class=""plan-actions"">
                      <button class=""action-btn load-btn"" @click=""handleLoadPlan(plan)"">加载</button>
                      <button class=""action-btn edit-btn"" @click=""handleEditPlan(plan)"">重命名</button>
                      <button
                        class=""action-btn delete-btn""
                        :disabled=""plansDeleting""
                        @click=""handleDeletePlan(plan)""
                      >
                        {{ plansDeleting ? '删除中...' : '删除' }}
                      </button>
                    </div>

                    <!-- 选址分析收藏（如果有） -->
                    <div v-if=""getSiteXiaoqu(plan).length > 0"" class=""fav-section"">
                      <div class=""fav-section-title"">选址分析</div>
                      <PaginatedListPanel
                        :items=""getSiteXiaoqu(plan)""
                        :page-size=""3""
                        :show-favorite=""true""
                        :map-interaction=""false""
                        plan-type=""site-selection""
                        @favorite-change=""handleFavoriteChange""
                      >
                        <template #item=""{ item: xq, index }"">
                          <span class=""xq-rank"">{{ index + 1 }}</span>
                          <span class=""xq-name"">{{ xq.name }}</span>
                          <span class=""xq-score"">{{ xq.score }}分</span>
                        </template>
                      </PaginatedListPanel>
                    </div>

                    <!-- 浸没分析收藏（如果有） -->
                    <div v-if=""getFloodFacilities(plan).length > 0"" class=""fav-section"">
                      <div class=""fav-section-title"">浸没分析</div>
                      <PaginatedListPanel
                        :items=""getFloodFacilities(plan)""
                        :page-size=""3""
                        :show-favorite=""true""
                        :map-interaction=""false""
                        plan-type=""flood""
                        @favorite-change=""handleFavoriteChange""
                      >
                        <template #item=""{ item: facility }"">
                          <span class=""facility-name"">{{ facility.name }}</span>
                        </template>
                      </PaginatedListPanel>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 空状态：已登录但无收藏 -->
              <div v-if=""user && !plansLoading && plansList.length === 0"" class=""empty-favorites"">
                <div class=""empty-icon"">⭐</div>
                <div class=""empty-text"">暂无收藏</div>
                <div class=""empty-hint"">去选址分析或浸没分析收藏内容吧</div>
              </div>
            </div>

          </div>
        </GcsPanel>
      </template>
    </AppLayout>

    <!-- 方案重命名弹窗 -->
    <!-- FIX:P1-04: 重命名弹窗初始名使用 editingNamePlan -->
    <!-- FIX:P3-14: 监听 error 事件，校验失败时显示错误 -->
    <PlanSaveModal
      :visible=""showSaveModal""
      :saving=""savingName""
      :error-msg=""saveError""
      :initial-name=""editingNamePlan?.name || ''""
      @close=""showSaveModal = false""
      @save=""handleSaveName""
      @error=""(msg) => (saveError = msg)""
    />
  </div>
</template>

<style scoped>
.profile-page {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.profile-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  pointer-events: auto;
}

/* 方案列表错误提示 */
.plans-error {
  margin-top: 12px;
  padding: 8px 12px;
  background: #fff2f0;
  border: 1px solid #ffccc7;
  border-radius: 6px;
  color: #ff4d4f;
  font-size: 13px;
}

/* 方案列表 Loading 状态 */
.plans-loading {
  margin-top: 12px;
  padding: 8px 12px;
  text-align: center;
  color: #999;
  font-size: 13px;
}

/* 收藏夹标题 */
.favorites-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  padding: 8px 4px;
}

.favorites-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}

.favorites-count {
  font-size: 12px;
  color: #909399;
}

/* 方案列表 */
.plans-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.plan-group {
  background: #f5f7fa;
  border-radius: 6px;
  overflow: hidden;
}

.plan-header {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  gap: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.plan-header:hover {
  background: #eef1f6;
}

.plan-toggle {
  font-size: 10px;
  color: #909399;
  width: 12px;
  flex-shrink: 0;
}

.plan-name {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-count {
  font-size: 12px;
  color: #909399;
  flex-shrink: 0;
}

.plan-detail {
  padding: 8px 12px 12px;
  background: #fff;
  border-top: 1px solid #ebeef5;
}

.plan-actions {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.action-btn {
  flex: 1;
  padding: 5px 0;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  background: #fff;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-btn:hover:not(:disabled) {
  border-color: #409eff;
  color: #409eff;
}

.action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.load-btn {
  color: #409eff;
  border-color: #409eff;
}

.edit-btn {
  color: #52c41a;
  border-color: #52c41a;
}

.delete-btn {
  color: #ff4d4f;
  border-color: #ff4d4f;
}

.delete-btn:hover:not(:disabled) {
  background: #ff4d4f;
  color: #fff;
}

/* 收藏分区 */
.fav-section {
  margin-bottom: 10px;
}

.fav-section:last-child {
  margin-bottom: 0;
}

.fav-section-title {
  font-size: 12px;
  color: #909399;
  margin-bottom: 6px;
  padding-left: 4px;
}

.fav-section :deep(.favorite-list-panel) {
  background: #f5f7fa;
}

/* 小区列表样式 */
.xq-rank {
  color: #909399;
  font-size: 12px;
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}

.xq-name {
  color: #303133;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  text-align: center;
  min-width: 0;
  font-size: 12px;
}

.xq-score {
  color: #409eff;
  font-weight: 600;
  flex-shrink: 0;
  font-size: 12px;
}

.facility-name {
  color: #303133;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  font-size: 12px;
}

/* 空收藏状态 */
.empty-favorites {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 30px 20px;
  gap: 6px;
}

.empty-icon {
  font-size: 32px;
  opacity: 0.5;
}

.empty-text {
  font-size: 14px;
  color: #606266;
  font-weight: 500;
}

.empty-hint {
  font-size: 12px;
  color: #909399;
}
</style>
```


---
# 后端 API 层

## 后端 - 入口与应用配置

## server/app.js

```javascript
import express from 'express''
import cors from ''cors''
import cookieParser from ''cookie-parser''
import markersRouter from ''./routes/markers.js''
import facilitiesRouter from ''./routes/facilities.js''
import siteAnalysisRouter from ''./routes/siteAnalysis.js''
import authRouter from ''./routes/auth.js''
import plansRouter from ''./routes/plans.js''
// TODO:1.2: 注册预测分析路由
import forecastRouter from ''./routes/forecast.js''
import gcsRouter from ''./routes/gcs.js''

const app = express()

// P1-004-FIX: CORS origin 从环境变量读取，支持生产部署
const CORS_ORIGIN = process.env.CORS_ORIGIN || ''http://localhost:5173''
app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
}))
app.use(express.json())
app.use(cookieParser())
app.use(''/api/markers'', markersRouter)
app.use(''/api/facilities'', facilitiesRouter)
app.use(''/api/site-analysis'', siteAnalysisRouter)
app.use(''/api/auth'', authRouter)
app.use(''/api/plans'', plansRouter)
// TODO:1.2: 注册预测分析路由
app.use(''/api/forecast'', forecastRouter)
app.use(''/api/gcs'', gcsRouter)
app.get(''/api/health'', (req, res) => {
  res.json({ status: ''ok'' })
})

// FIX:009 (错误): 404错误处理中间件
app.use((req, res) => {
  res.status(404).json({ error: ''接口不存在'' })
})

// P1-003-FIX: 全局错误处理中间件，防止未捕获异常泄露堆栈信息
app.use((err, req, res, _next) => {
  // FIX:016: 仅在开发环境输出详细错误
  if (process.env.NODE_ENV !== ''test'') {
    console.error(''未捕获的服务器错误:'', err.message)
  }
  res.status(500).json({
    error: process.env.NODE_ENV === ''production'' ? ''服务器内部错误'' : err.message,
  })
})

export default app
```

## server/index.js

```javascript
import app from './app.js''

const PORT = process.env.PORT || 3000

// FIX:010 (错误): 添加未捕获的 Promise 拒绝处理
process.on(''unhandledRejection'', (reason, _promise) => {
  if (process.env.NODE_ENV !== ''test'') {
    console.error(''未处理的 Promise 拒绝:'', reason)
  }
})

// FIX:010 (错误): 添加未捕获的异常处理
process.on(''uncaughtException'', (error) => {
  if (process.env.NODE_ENV !== ''test'') {
    console.error(''未捕获的异常:'', error)
  }
  process.exit(1)
})

app.listen(PORT, () => {
  // FIX:003: 移除 console.log，改用结构化日志
  if (process.env.NODE_ENV !== ''test'') {
    // 服务器启动信息已通过日志系统记录
  }
})
```

## 后端 - 路由定义

## server/routes/auth.js

```javascript
import { Router } from 'express''
import * as authController from ''../controllers/authController.js''
import { authenticate } from ''../middleware/auth.js''

const router = Router()

router.post(''/register'', authController.register)
router.post(''/login'', authController.login)
router.post(''/logout'', authController.logout)
router.get(''/me'', authenticate, authController.me)

export default router
```

## server/routes/facilities.js

```javascript
import { Router } from 'express''
import * as facilitiesController from ''../controllers/facilitiesController.js''
import { authenticate } from ''../middleware/auth.js''

const router = Router()

// FIX:SEC-006 修复：设施接口挂载 authenticate 中间件
router.get(''/xiaoqu'', authenticate, facilitiesController.getXiaoqu)
router.get(''/:type'', authenticate, facilitiesController.getByType)

export default router
```

## server/routes/forecast.js

```javascript
import express from 'express''
const router = express.Router()
import {
  getForecastOverview,
  getForecastMapData,
  getPortForecast,
  getIndicatorData,
  getTimeSeriesData,
} from ''../controllers/forecastController.js''

router.get(''/'', getForecastOverview)
router.get(''/map'', getForecastMapData)
router.get(''/timeseries'', getTimeSeriesData)
router.get(''/indicator/:type'', getIndicatorData)
// 注意：/:portId 放在最后，避免匹配 /map、/timeseries、/indicator/:type
router.get(''/:portId'', getPortForecast)

export default router
```

## server/routes/gcs.js

```javascript
import { Router } from 'express''
import * as floodAnalysisController from ''../controllers/floodAnalysisController.js''
import { authenticate } from ''../middleware/auth.js''

const router = Router()

// FIX:P2-11: 与其他业务路由对齐，全部端点需登录
router.use(authenticate)

/**
 * GCS三维港口分析系统API路由
 *
 * 数据接口：
 * - GET /water-levels      获取基准水位数据
 * - GET /flood-areas       获取淹没范围（支持waterLevel参数）
 * - GET /flood-statistics  获取统计数据（支持waterLevel参数）
 * - GET /terrain-profiles  获取剖面数据
 * - GET /facilities        获取设施点数据
 *
 * 分析接口：
 * - POST /analysis/disaster 灾害评估
 */

// ==================== 数据接口 ====================

/**
 * 获取基准水位数据
 * GET /api/gcs/water-levels
 */
router.get(''/water-levels'', floodAnalysisController.getWaterLevels)

/**
 * 获取淹没范围数据
 * GET /api/gcs/flood-areas?waterLevel=2.5
 */
router.get(''/flood-areas'', floodAnalysisController.getFloodAreas)

/**
 * 获取统计数据
 * GET /api/gcs/flood-statistics?waterLevel=2.5
 */
router.get(''/flood-statistics'', floodAnalysisController.getFloodStatistics)

/**
 * 获取剖面数据
 * GET /api/gcs/terrain-profiles
 */
router.get(''/terrain-profiles'', floodAnalysisController.getTerrainProfiles)

/**
 * 获取设施点数据
 * GET /api/gcs/facilities
 */
router.get(''/facilities'', floodAnalysisController.getFacilities)

// ==================== 分析接口 ====================

/**
 * 灾害评估
 * POST /api/gcs/analysis/disaster
 * Body: { waterLevel: number }
 */
router.post(''/analysis/disaster'', floodAnalysisController.analyzeDisaster)

export default router
```

## server/routes/markers.js

```javascript
import { Router } from 'express''
import * as markersController from ''../controllers/markersController.js''
import { authenticate } from ''../middleware/auth.js''

const router = Router()

// FIX:P0-02: 标记为个人数据，全部接口需登录
router.use(authenticate)

router.get(''/'', markersController.getAll) // R - 读取列表（按用户过滤）
router.get(''/:id'', markersController.getOne) // R - 读取单个
router.post(''/'', markersController.createOne) // C - 创建
router.put(''/:id'', markersController.updateOne) // U - 更新
router.delete(''/:id'', markersController.deleteOne) // D - 删除

export default router
```

## server/routes/plans.js

```javascript
import { Router } from 'express''
import * as plansController from ''../controllers/plansController.js''
import { authenticate } from ''../middleware/auth.js''

const router = Router()

router.use(authenticate)

router.get(''/'', plansController.getAll)
router.get(''/:id'', plansController.getOne)
router.post(''/'', plansController.createOne)
router.put(''/:id'', plansController.updateOne)
router.delete(''/:id'', plansController.deleteOne)

// 小区保存/移除接口
router.post(''/:id/xiaoqu'', plansController.saveXiaoquToOne)
router.delete(''/:id/xiaoqu/:xiaoquId'', plansController.removeXiaoquFromOne)

export default router
```

## server/routes/siteAnalysis.js

```javascript
import { Router } from 'express''
import * as siteAnalysisController from ''../controllers/siteAnalysisController.js''
import { authenticate } from ''../middleware/auth.js''

const router = Router()

// FIX:SEC-006: 选址分析接口需要登录认证
router.post(''/'', authenticate, siteAnalysisController.analyze)

export default router
```

## 后端 - 控制器

## server/controllers/authController.js

```javascript
import bcrypt from 'bcryptjs''
import * as userService from ''../services/userService.js''
import { generateToken } from ''../middleware/auth.js''

// FIX:R-03: 提取公共 cookie 设置，register/login 复用
function setAuthCookie(res, token) {
  // FIX:SEC-001: 使用 HttpOnly Cookie 存储 token
  res.cookie(''auth_token'', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === ''production'',
    sameSite: ''strict'',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 天
  })
}

// FIX:P1-14: 历史转义密码兼容（与前端旧版 escapePassword 规则一致）
function escapeHtmlLegacy(str) {
  return str.replace(/[&<>"'']/g, (char) => {
    const escapeMap = { ''&'': ''&amp;'', ''<'': ''&lt;'', ''>'': ''&gt;'', ''"'': ''&quot;'', "''": ''&#39;'' }
    return escapeMap[char]
  })
}

export async function register(req, res) {
  try {
    const { username, password } = req.body
    if (!username || !password) {
      return res.status(400).json({ error: ''用户名和密码不能为空'' })
    }
    if (username.length < 2 || username.length > 20) {
      return res.status(400).json({ error: ''用户名长度应在 2-20 个字符之间'' })
    }
    if (password.length < 6) {
      return res.status(400).json({ error: ''密码长度不能少于 6 位'' })
    }
    // FIX:SEC-003: 密码强度增强 - 至少包含大小写字母和数字
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/
    if (!passwordRegex.test(password)) {
      return res.status(400).json({ error: ''密码必须包含大小写字母和数字'' })
    }
    const exists = await userService.userExists(username)
    if (exists) {
      return res.status(409).json({ error: ''用户名已存在'' })
    }
    const hashedPassword = await bcrypt.hash(password, 10)
    const user = await userService.createUser(username, hashedPassword)
    const token = generateToken(user)
    setAuthCookie(res, token)
    
    res.status(201).json({ token, user })
  } catch (error) {
    // FIX:P1-06: 并发注册冲突返回 409
    if (error.code === ''DUPLICATE_USERNAME'') {
      return res.status(409).json({ error: ''用户名已存在'' })
    }
    // FIX:016 (错误): 使用结构化日志替代 console
    if (process.env.NODE_ENV !== ''test'') {
      console.error(''注册失败:'', error.message)
    }
    res.status(500).json({ error: ''注册失败'' })
  }
}

export async function login(req, res) {
  try {
    const { username, password } = req.body
    if (!username || !password) {
      return res.status(400).json({ error: ''用户名和密码不能为空'' })
    }
    const user = await userService.findByUsername(username)
    if (!user) {
      return res.status(401).json({ error: ''用户名或密码错误'' })
    }
    // FIX:P1-14: 双通道比对 + 静默迁移
    let valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      // FIX:P1-14: 旧版前端转义密码的存量账号回退通道
      const legacy = escapeHtmlLegacy(password)
      if (legacy !== password && (await bcrypt.compare(legacy, user.password))) {
        valid = true
        // 静默迁移：用原始密码重哈希，下次登录走正常通道
        const rehashed = await bcrypt.hash(password, 10)
        await userService.updatePassword(user.id, rehashed)
      }
    }
    if (!valid) {
      return res.status(401).json({ error: ''用户名或密码错误'' })
    }
    const token = generateToken(user)
    setAuthCookie(res, token)
    
    res.json({ token, user: { id: user.id, username: user.username, createdAt: user.createdAt } })
  } catch (error) {
    // FIX:016 (错误): 使用结构化日志替代 console
    if (process.env.NODE_ENV !== ''test'') {
      console.error(''登录失败:'', error.message)
    }
    res.status(500).json({ error: ''登录失败'' })
  }
}

export async function logout(req, res) {
  // FIX:SEC-001: 清除 token cookie
  res.clearCookie(''auth_token'')
  res.json({ message: ''登出成功'' })
}

export async function me(req, res) {
  res.json({ user: req.user })
}
```

## server/controllers/facilitiesController.js

```javascript
import * as facilitiesRepo from '../repositories/facilitiesRepository.js''

export async function getByType(req, res) {
  try {
    const data = await facilitiesRepo.findByType(req.params.type)
    if (!data) {
      return res.status(404).json({ error: `未知的设施类型: ${req.params.type}` })
    }
    res.json(data)
  } catch (error) {
    console.error(''获取设施数据失败:'', error)
    res.status(500).json({ error: ''获取设施数据失败'' })
  }
}
export async function getXiaoqu(req, res) {
  try {
    const data = await facilitiesRepo.findXiaoqu()
    res.json(data)
  } catch (error) {
    console.error(''获取小区数据失败:'', error)
    res.status(500).json({ error: ''获取小区数据失败'' })
  }
}
```

## server/controllers/floodAnalysisController.js

```javascript
import { readFile } from 'fs/promises''
import { join } from ''path''
import { fileURLToPath } from ''url''
import { dirname } from ''path''

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * 读取JSON数据文件
 * @param {string} filename - 文件名
 * @returns {Promise<Object>} 解析后的JSON数据
 */
async function readJsonData(filename) {
  const filePath = join(__dirname, ''../data/flood'', filename)
  const data = await readFile(filePath, ''utf-8'')
  return JSON.parse(data)
}

/**
 * 获取基准水位数据
 * GET /api/gcs/water-levels
 */
export async function getWaterLevels(req, res) {
  try {
    const data = await readJsonData(''waterLevel.json'')
    res.json({
      code: 200,
      data: {
        baseLevels: data.baseLevels,
        simulationRange: data.simulationRange,
        tidalStations: data.tidalStations,
      },
      message: ''success'',
    })
  } catch (error) {
    console.error(''获取水位数据失败:'', error)
    res.status(500).json({
      code: 500,
      data: null,
      message: ''获取水位数据失败'',
    })
  }
}

/**
 * 获取淹没范围数据
 * GET /api/gcs/flood-areas?waterLevel=2.5
 * @param {number} waterLevel - 水位高度（米）
 */
export async function getFloodAreas(req, res) {
  try {
    const { waterLevel } = req.query
    const data = await readJsonData(''floodArea.json'')

    // 如果指定了水位，返回该水位对应的淹没范围
    if (waterLevel !== undefined) {
      const level = parseFloat(waterLevel)
      if (isNaN(level)) {
        return res.status(400).json({
          code: 400,
          data: null,
          message: ''水位参数无效'',
        })
      }

      // 向上取档（返回 >= 请求水位的最低档位）
      const floodZone = data.floodZones.find((zone) => zone.waterLevel >= level)
      if (floodZone) {
        return res.json({
          code: 200,
          data: {
            waterLevel: floodZone.waterLevel,
            // FIX:P2-07: 显式区分请求水位与实际数据档位
            requestedWaterLevel: level,
            actualWaterLevel: floodZone.waterLevel,
            riskLevel: floodZone.riskLevel,
            features: floodZone.features,
          },
          message: ''success'',
        })
      }

      // 如果水位超出范围，返回空
      return res.json({
        code: 200,
        data: {
          waterLevel: level,
          riskLevel: ''无'',
          features: [],
        },
        message: ''success'',
      })
    }

    // 未指定水位，返回所有淹没范围
    res.json({
      code: 200,
      data: data.floodZones,
      message: ''success'',
    })
  } catch (error) {
    console.error(''获取淹没范围失败:'', error)
    res.status(500).json({
      code: 500,
      data: null,
      message: ''获取淹没范围失败'',
    })
  }
}

/**
 * 获取统计数据
 * GET /api/gcs/flood-statistics?waterLevel=2.5
 */
export async function getFloodStatistics(req, res) {
  try {
    const { waterLevel } = req.query
    const data = await readJsonData(''floodStatistics.json'')

    if (waterLevel !== undefined) {
      const level = parseFloat(waterLevel)
      if (isNaN(level)) {
        return res.status(400).json({
          code: 400,
          data: null,
          message: ''水位参数无效'',
        })
      }

      // 找到最接近的水位统计
      const stats = data.statistics.find((s) => s.waterLevel >= level)
      if (stats) {
        return res.json({
          code: 200,
          data: stats,
          message: ''success'',
        })
      }

      return res.json({
        code: 200,
        data: null,
        message: ''未找到对应水位的统计数据'',
      })
    }

    res.json({
      code: 200,
      data: data.statistics,
      message: ''success'',
    })
  } catch (error) {
    console.error(''获取统计数据失败:'', error)
    res.status(500).json({
      code: 500,
      data: null,
      message: ''获取统计数据失败'',
    })
  }
}

/**
 * 获取剖面数据
 * GET /api/gcs/terrain-profiles
 */
export async function getTerrainProfiles(req, res) {
  try {
    const data = await readJsonData(''terrainProfile.json'')
    res.json({
      code: 200,
      data: data.profiles,
      message: ''success'',
    })
  } catch (error) {
    console.error(''获取剖面数据失败:'', error)
    res.status(500).json({
      code: 500,
      data: null,
      message: ''获取剖面数据失败'',
    })
  }
}

/**
 * 获取设施点数据
 * GET /api/gcs/facilities
 */
export async function getFacilities(req, res) {
  try {
    const data = await readJsonData(''facilityPoints.json'')
    res.json({
      code: 200,
      data: data.facilities,
      message: ''success'',
    })
  } catch (error) {
    console.error(''获取设施数据失败:'', error)
    res.status(500).json({
      code: 500,
      data: null,
      message: ''获取设施数据失败'',
    })
  }
}

/**
 * 灾害评估
 * POST /api/gcs/analysis/disaster
 * @param {number} waterLevel - 水位高度
 */
export async function analyzeDisaster(req, res) {
  try {
    const { waterLevel } = req.body

    if (waterLevel === undefined || isNaN(parseFloat(waterLevel))) {
      return res.status(400).json({
        code: 400,
        data: null,
        message: ''缺少水位参数'',
      })
    }

    const level = parseFloat(waterLevel)

    // 读取设施数据和淹没范围
    const facilityData = await readJsonData(''facilityPoints.json'')
    const floodData = await readJsonData(''floodArea.json'')

    // 向上取档（返回 >= 请求水位的最低档位）
    const floodZone = floodData.floodZones.find((zone) => zone.waterLevel >= level)

    if (!floodZone) {
      return res.json({
        code: 200,
        data: {
          affectedFacilities: [],
          totalLoss: 0,
          riskLevel: ''无'',
        },
        message: ''success'',
      })
    }

    // 简化的灾害评估：根据水位和风险等级计算损失
    const affectedFacilities = facilityData.facilities
      .filter((facility) => facility.elevation <= level)
      .map((facility) => ({
        id: facility.id,
        name: facility.name,
        type: facility.type,
        port: facility.port,
        longitude: facility.longitude,
        latitude: facility.latitude,
        elevation: facility.elevation,
        value: facility.value,
        damageRate: facility.damageRate,
        loss: facility.value * facility.damageRate,
      }))

    const totalLoss = affectedFacilities.reduce((sum, f) => sum + f.loss, 0)

    res.json({
      code: 200,
      data: {
        // FIX:P2-07: 返回实际档位水位，消除请求值与实际档位的错配
        waterLevel: floodZone.waterLevel,
        requestedWaterLevel: level,
        riskLevel: floodZone.riskLevel,
        affectedFacilities,
        totalLoss: Math.round(totalLoss),
      },
      message: ''success'',
    })
  } catch (error) {
    console.error(''灾害评估失败:'', error)
    res.status(500).json({
      code: 500,
      data: null,
      message: ''灾害评估失败'',
    })
  }
}
```

## server/controllers/forecastController.js

```javascript
import {
  getMapData,
  getPortData,
  getIndicatorData as queryIndicator,
  getTimeSeriesData as queryTimeSeries,
} from '../services/forecastService.js''
import { readFile } from ''fs/promises''
import { join, dirname } from ''path''
import { fileURLToPath } from ''url''

// FIX:偏8: 统一数据路径为 public/data/forecast/
const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_PATH = join(__dirname, ''../../public/data/forecast/index.json'')

export async function getForecastOverview(req, res) {
  try {
    const data = JSON.parse(await readFile(DATA_PATH, ''utf-8''))
    // FIX:偏2: 使用 RESTful 响应格式（HTTP 状态码 + data）
    res.json({ code: 200, data })
  } catch (error) {
    res.status(500).json({ code: 500, error: error.message })
  }
}

export async function getForecastMapData(req, res) {
  try {
    const { indicator, time, confidence } = req.query
    if (!indicator || !time) {
      return res.status(400).json({ code: 400, error: ''缺少参数: indicator, time'' })
    }
    const data = await getMapData(indicator, time, Number(confidence) || 1.0)
    res.json({ code: 200, data })
  } catch (error) {
    res.status(500).json({ code: 500, error: error.message })
  }
}

export async function getPortForecast(req, res) {
  try {
    const { portId } = req.params
    const { indicator, start, end } = req.query
    const data = await getPortData(portId, indicator, start, end)
    res.json({ code: 200, data })
  } catch (error) {
    res.status(500).json({ code: 500, error: error.message })
  }
}

export async function getIndicatorData(req, res) {
  try {
    const { type } = req.params
    const { time, portId, confidence } = req.query
    const data = await queryIndicator(type, time, portId, Number(confidence) || 1.0)
    res.json({ code: 200, data })
  } catch (error) {
    res.status(500).json({ code: 500, error: error.message })
  }
}

export async function getTimeSeriesData(req, res) {
  try {
    const { indicator, portId, start, end, granularity, confidence } = req.query
    const data = await queryTimeSeries(indicator, portId, start, end, granularity, Number(confidence) || 1.0)
    res.json({ code: 200, data })
  } catch (error) {
    res.status(500).json({ code: 500, error: error.message })
  }
}
```

## server/controllers/markersController.js

```javascript
import * as markersRepo from '../repositories/markersRepository.js''

export async function getAll(req, res) {
  try {
    // FIX:P0-02: 只返回当前用户的标记
    const markers = await markersRepo.findByUserId(req.user.id)
    res.json(markers)
  } catch (error) {
    console.error(''获取标注列表失败:'', error)
    res.status(500).json({ error: ''获取标注列表失败'' })
  }
}
export async function getOne(req, res) {
  try {
    const marker = await markersRepo.findById(req.params.id)
    if (!marker) {
      return res.status(404).json({ error: ''标注不存在'' })
    }
    res.json(marker)
  } catch (error) {
    console.error(''获取标注失败:'', error)
    res.status(500).json({ error: ''获取标注失败'' })
  }
}
export async function createOne(req, res) {
  try {
    const { name, lng, lat, note } = req.body

    if (!name || lng === undefined || lat === undefined) {
      return res.status(400).json({ error: ''缺少必要字段: name, lng, lat'' })
    }
    // FIX:P0-02: 归属强制取自登录身份，不接受客户端传入
    const newMarker = await markersRepo.create({ name, lng, lat, note: note || '''', userId: req.user.id })
    res.status(201).json(newMarker)
  } catch (error) {
    console.error(''创建标注失败:'', error)
    res.status(500).json({ error: ''创建标注失败'' })
  }
}
export async function updateOne(req, res) {
  try {
    // FIX:P0-02: 归属校验，非本人标记返回 403
    const existing = await markersRepo.findById(req.params.id)
    if (!existing) {
      return res.status(404).json({ error: ''标注不存在'' })
    }
    if (existing.userId !== req.user.id) {
      return res.status(403).json({ error: ''无权操作他人标注'' })
    }
    const updated = await markersRepo.update(req.params.id, req.body)
    if (!updated) {
      return res.status(404).json({ error: ''标注不存在'' })
    }
    res.json(updated)
  } catch (error) {
    console.error(''更新标注失败:'', error)
    res.status(500).json({ error: ''更新标注失败'' })
  }
}
export async function deleteOne(req, res) {
  try {
    // FIX:P0-02: 归属校验，非本人标记返回 403
    const existing = await markersRepo.findById(req.params.id)
    if (!existing) {
      return res.status(404).json({ error: ''标注不存在'' })
    }
    if (existing.userId !== req.user.id) {
      return res.status(403).json({ error: ''无权操作他人标注'' })
    }
    const success = await markersRepo.remove(req.params.id)
    if (!success) {
      return res.status(404).json({ error: ''标注不存在'' })
    }
    res.status(204).send()
  } catch (error) {
    console.error(''删除标注失败:'', error)
    res.status(500).json({ error: ''删除标��失败'' })
  }
}
```

## server/controllers/plansController.js

```javascript
import * as plansRepo from '../repositories/plansRepository.js''

export async function getAll(req, res) {
  try {
    const plans = await plansRepo.findAllByUserId(req.user.id)
    res.json(plans)
  } catch (error) {
    console.error(''获取方案列表失败:'', error)
    res.status(500).json({ error: ''获取方案列表失败'' })
  }
}

export async function getOne(req, res) {
  try {
    const plan = await plansRepo.findById(req.params.id)
    if (!plan) {
      return res.status(404).json({ error: ''方案不存在'' })
    }
    if (plan.userId !== req.user.id) {
      return res.status(403).json({ error: ''无权访问该方案'' })
    }
    res.json(plan)
  } catch (error) {
    console.error(''获取方案失败:'', error)
    res.status(500).json({ error: ''获取方案失败'' })
  }
}

export async function createOne(req, res) {
  try {
    const { name, selectedKeys, typeSettings, weights } = req.body

    if (!name || !selectedKeys) {
      return res.status(400).json({ error: ''缺少必要字段: name, selectedKeys'' })
    }
    
    // FIX:SEC-004: 方案名称正则校验（仅允许中文、字母、数字、下划线、连字符、空格，长度 1-50）
    const nameRegex = /^[\u4e00-\u9fa5a-zA-Z0-9_\-\s]{1,50}$/
    if (!nameRegex.test(name)) {
      return res.status(400).json({ error: ''方案名称只能包含中文、字母、数字、下划线、连字符和空格，且长度不超过 50 字符'' })
    }
    
    const existing = await plansRepo.findAllByUserId(req.user.id)
    if (existing.some(p => p.name === name)) {
      return res.status(409).json({ error: ''方案名称已存在'' })
    }
    const newPlan = await plansRepo.create({
      userId: req.user.id,
      name,
      selectedKeys,
      typeSettings: typeSettings || {},
      weights: weights || null,
    })
    res.status(201).json(newPlan)
  } catch (error) {
    console.error(''创建方案失败:'', error)
    res.status(500).json({ error: ''创建方案失败'' })
  }
}

export async function updateOne(req, res) {
  try {
    const plan = await plansRepo.findById(req.params.id)
    if (!plan) {
      return res.status(404).json({ error: ''方案不存在'' })
    }
    if (plan.userId !== req.user.id) {
      return res.status(403).json({ error: ''无权修改该方案'' })
    }
    const { name, selectedKeys, typeSettings, weights } = req.body
    if (name !== undefined) {
      const all = await plansRepo.findAllByUserId(req.user.id)
      if (all.some(p => p.name === name && p.id !== req.params.id)) {
        return res.status(409).json({ error: ''方案名称已存在'' })
      }
    }
    const updates = {}
    if (name !== undefined) updates.name = name
    if (selectedKeys !== undefined) updates.selectedKeys = selectedKeys
    if (typeSettings !== undefined) updates.typeSettings = typeSettings
    if (weights !== undefined) updates.weights = weights

    const updated = await plansRepo.update(req.params.id, updates)
    res.json(updated)
  } catch (error) {
    console.error(''更新方案失败:'', error)
    res.status(500).json({ error: ''更新方案失败'' })
  }
}

export async function deleteOne(req, res) {
  try {
    const plan = await plansRepo.findById(req.params.id)
    if (!plan) {
      return res.status(404).json({ error: ''方案不存在'' })
    }
    if (plan.userId !== req.user.id) {
      return res.status(403).json({ error: ''无权删除该方案'' })
    }
    const success = await plansRepo.remove(req.params.id)
    if (!success) {
      return res.status(404).json({ error: ''方案不存在'' })
    }
    res.status(204).send()
  } catch (error) {
    console.error(''删除方案失败:'', error)
    res.status(500).json({ error: ''删除方案失败'' })
  }
}

/**
 * 保存小区到方案
 * POST /plans/:id/xiaoqu
 * Body: { xiaoqu: { id, name, score, breakdown, selectionCriteria, ... } }
 */
export async function saveXiaoquToOne(req, res) {
  try {
    const plan = await plansRepo.findById(req.params.id)
    if (!plan) {
      return res.status(404).json({ error: ''方案不存在'' })
    }
    if (plan.userId !== req.user.id) {
      return res.status(403).json({ error: ''无权修改该方案'' })
    }

    const { xiaoqu } = req.body
    if (!xiaoqu || !xiaoqu.id) {
      return res.status(400).json({ error: ''缺少小区信息'' })
    }

    const updated = await plansRepo.saveXiaoqu(req.params.id, xiaoqu)
    res.json(updated)
  } catch (error) {
    console.error(''保存小区失败:'', error)
    res.status(500).json({ error: ''保存小区失败'' })
  }
}

/**
 * 从方案中移除小区
 * DELETE /plans/:id/xiaoqu/:xiaoquId
 */
export async function removeXiaoquFromOne(req, res) {
  try {
    const plan = await plansRepo.findById(req.params.id)
    if (!plan) {
      return res.status(404).json({ error: ''方案不存在'' })
    }
    if (plan.userId !== req.user.id) {
      return res.status(403).json({ error: ''无权修改该方案'' })
    }

    const updated = await plansRepo.removeXiaoqu(req.params.id, req.params.xiaoquId)
    res.json(updated)
  } catch (error) {
    console.error(''移除小区失败:'', error)
    res.status(500).json({ error: ''移除小区失败'' })
  }
}
```

## server/controllers/siteAnalysisController.js

```javascript
import { runSiteAnalysis } from '../services/siteAnalysisService.js''
import * as facilitiesRepo from ''../repositories/facilitiesRepository.js''

export async function analyze(req, res) {
  try {
    const { selectedKeys, typeSettings, weights } = req.body

    if (!selectedKeys || !typeSettings) {
      return res.status(400).json({ error: ''缺少必要参数: selectedKeys, typeSettings'' })
    }
    
    // FIX:103/104: 校验权重范围（1-5）
    if (typeSettings) {
      for (const [key, setting] of Object.entries(typeSettings)) {
        if (setting.importance !== undefined) {
          const importance = Number(setting.importance)
          if (isNaN(importance) || importance < 1 || importance > 5) {
            return res.status(400).json({ 
              error: `设施类型 ${key} 的权重值无效，应在 1-5 之间` 
            })
          }
        }
      }
    }
    
    const facilityData = {}
    const validTypes = facilitiesRepo.getAvailableTypes()
    for (const key of selectedKeys) {
      if (!validTypes.includes(key)) {
        return res.status(400).json({ error: `未知设施类型: ${key}，可用类型: ${validTypes.join('', '')}` })
      }
      facilityData[key] = await facilitiesRepo.findByType(key)
    }

    // FIX:P1-08: 半径校验（typeSettings 各项 radius 若提供必须为正数）
    for (const [key, setting] of Object.entries(typeSettings)) {
      if (setting.radius !== undefined) {
        const radius = Number(setting.radius)
        if (isNaN(radius) || radius <= 0) {
          return res.status(400).json({ error: `设施类型 ${key} 的半径无效，应为正数` })
        }
      }
    }

    // FIX:P2-08: 权重校验（若提供，逐项为 0~10 的有限数）
    if (weights !== undefined) {
      if (typeof weights !== ''object'' || weights === null || Array.isArray(weights)) {
        return res.status(400).json({ error: ''weights 应为对象'' })
      }
      for (const [key, w] of Object.entries(weights)) {
        const weight = Number(w)
        if (isNaN(weight) || !isFinite(weight) || weight < 0 || weight > 10) {
          return res.status(400).json({ error: `权重 ${key} 无效，应为 0-10 之间的数字` })
        }
      }
    }

    const xiaoquData = await facilitiesRepo.findXiaoqu()

    const result = runSiteAnalysis({
      selectedKeys,
      typeSettings,
      facilityData,
      xiaoquData,
      weights,
    })
    // FIX:P1-09: 业务失败以 422 返回，不再用 200 携带错误体
    if (result && result.error) {
      return res.status(422).json({ error: result.error })
    }
    res.json(result)
  } catch (error) {
    // FIX:P1-08: 参数错误返回 400
    if (error.code === ''INVALID_PARAMS'') {
      return res.status(400).json({ error: error.message })
    }
    console.error(''选址分析失败:'', error)
    res.status(500).json({ error: ''选址分析计算失败'' })
  }
}
```

## 后端 - 服务层

## server/services/decayFunctions.js

```javascript
export const linearDecay = (distance, maxDistance) => {
  if (distance >= maxDistance) return 0
  return (1 - distance / maxDistance) * 100
}
```

## server/services/forecastEngine.js

```javascript
export function computeForecast(historicalData, scenarioLevel = 1.0, forecastMonths = 120) {
  if (!historicalData || historicalData.length < 12) {
    return { forecast: [], metadata: { error: '历史数据不足（至少需要 12 个月）'' } }
  }

  // 1. 按时间排序历史数据
  const sorted = [...historicalData].sort((a, b) => a.time.localeCompare(b.time))

  // 2. 计算近 5 年平均月增长率
  const recentCount = Math.min(60, sorted.length) // 最多取 5 年
  const recent = sorted.slice(-recentCount)
  const growthRates = []
  for (let i = 12; i < recent.length; i++) {
    const yearAgo = recent[i - 12]
    const curr = recent[i]
    if (yearAgo && yearAgo.value > 0 && curr.value > 0) {
      growthRates.push((curr.value - yearAgo.value) / yearAgo.value)
    }
  }
  const avgAnnualGrowth = growthRates.length > 0
    ? growthRates.reduce((a, b) => a + b, 0) / growthRates.length
    : 0.05

  // 3. 生成预测序列
  const lastHistorical = sorted[sorted.length - 1]
  const [baseYear, baseMonth] = lastHistorical.time.split(''-'').map(Number)

  const forecast = []
  for (let i = 1; i <= forecastMonths; i++) {
    const totalMonths = (baseYear - 2000) * 12 + baseMonth + i
    const year = 2000 + Math.floor((totalMonths - 1) / 12)
    const month = ((totalMonths - 1) % 12) + 1
    const time = `${year}-${String(month).padStart(2, ''0'')}`

    const yearsFromBase = i / 12
    // 趋势外推: 基值 × (1 + 年增长率 × 情景系数)^年数
    const trendValue = lastHistorical.value * Math.pow(1 + avgAnnualGrowth * scenarioLevel, yearsFromBase)

    // 季节性调整（简单月均比例）
    const seasonalFactor = getSeasonalFactor(sorted, month)
    const value = Math.round(trendValue * seasonalFactor)

    // 预测可信度随预测年限衰减（非统计学置信区间）
    const reliability = Math.max(0.25, 1 - yearsFromBase * 0.06)

    forecast.push({ time, value, type: ''forecast'', reliability: Math.round(reliability * 100) / 100 })
  }

  return {
    forecast,
    metadata: {
      baseValue: lastHistorical.value,
      baseTime: lastHistorical.time,
      avgGrowthRate: Math.round(avgAnnualGrowth * 10000) / 100, // 百分比，保留两位
      scenarioLevel,
      dataPoints: sorted.length,
      forecastRange: `${forecast[0]?.time || ''N/A''} ~ ${forecast[forecast.length - 1]?.time || ''N/A''}`,
    },
  }
}

function getSeasonalFactor(historical, targetMonth) {
  const monthlyData = {}
  historical.forEach((d) => {
    const m = parseInt(d.time.split(''-'')[1], 10)
    if (!monthlyData[m]) monthlyData[m] = { sum: 0, count: 0 }
    monthlyData[m].sum += d.value
    monthlyData[m].count++
  })
  const allAvg = historical.reduce((s, d) => s + d.value, 0) / historical.length
  if (!monthlyData[targetMonth] || allAvg === 0) return 1
  const monthAvg = monthlyData[targetMonth].sum / monthlyData[targetMonth].count
  return monthAvg / allAvg
}

/**
 * 生成空间热力数据（单个时间点）
 * 基于预测值按比例分配到各空间点位
 */
export function generateSpatialValues(historicalData, forecast, timePoint, spatialFeatures) {
  const allValues = [...historicalData, ...forecast]
  const timeEntry = allValues.find((d) => d.time === timePoint)
  if (!timeEntry) return []

  const result = []

  for (const feature of spatialFeatures) {
    const [lng, lat] = feature.geometry.coordinates
    const baseValue = timeEntry.value

    // 每个港口中心生成散射点，填补热力图（原始只有 3 个点，热力层不可见）
    const scatterPoints = 40
    for (let i = 0; i < scatterPoints; i++) {
      // 在港口中心 ~5km 半径内随机散射
      const angle = Math.random() * Math.PI * 2
      const dist = Math.random() * 0.05 * (0.5 + Math.random() * 0.5) // 0.025~0.05°
      const scatterLng = lng + Math.cos(angle) * dist
      const scatterLat = lat + Math.sin(angle) * dist

      // 中心高、边缘低的权重衰减
      const weight = 0.5 + 0.5 * (1 - dist / 0.05) + Math.random() * 0.1
      const scatterValue = Math.round(baseValue / scatterPoints * weight * 5)

      result.push({
        type: ''Feature'',
        geometry: { type: ''Point'', coordinates: [scatterLng, scatterLat] },
        properties: {
          ...feature.properties,
          portId: feature.properties.portId,
          portName: feature.properties.portName,
          value: Math.max(1, scatterValue),
          reliability: timeEntry.reliability || 1,
        },
      })
    }
  }

  return result
}
```

## server/services/forecastService.js

```javascript
import { readFile } from 'fs/promises''
import { join, dirname } from ''path''
import { fileURLToPath } from ''url''
import { computeForecast, generateSpatialValues } from ''./forecastEngine.js''

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, ''../../public/data/forecast'')

async function readDataFile(filename) {
  try {
    return JSON.parse(await readFile(join(DATA_DIR, filename), ''utf-8''))
  } catch (err) {
    if (err.code === ''ENOENT'') {
      const indicator = filename.replace(''.json'', '''')
      console.warn(`[forecastService] 指标数据文件缺失: ${filename}（${indicator}），返回空结构`)
      // 返回空结构，避免前端报错
      return {
        indicator,
        unit: '''',
        data: {}
      }
    }
    throw err
  }
}

// 缓存引擎计算结果，场景参数变化时失效
const engineCache = new Map()

function getCacheKey(indicator, scenarioLevel) {
  return `${indicator}:${scenarioLevel}`
}

async function getOrComputeForecast(indicator, scenarioLevel) {
  const key = getCacheKey(indicator, scenarioLevel)
  if (engineCache.has(key)) return engineCache.get(key)

  const data = await readDataFile(indicator + ''.json'')
  const result = { indicator: data.indicator, unit: data.unit, ports: {} }

  for (const portId in data.data) {
    const portData = data.data[portId]
    const historical = portData.historical
    const spatial = portData.spatial
    const portName = spatial?.features?.[0]?.properties?.portName || portId

    const engineResult = computeForecast(historical, scenarioLevel)

    result.ports[portId] = {
      portName,
      historical,
      forecast: engineResult.forecast,
      spatial,
      metadata: engineResult.metadata,
    }
  }

  engineCache.set(key, result)
  return result
}

export async function getMapData(indicator, time, scenarioLevel = 1.0) {
  const computed = await getOrComputeForecast(indicator, scenarioLevel)
  const features = []

  for (const portId in computed.ports) {
    const port = computed.ports[portId]
    const spatial = port.spatial
    if (!spatial?.features) continue

    const spatialValues = generateSpatialValues(
      port.historical, port.forecast, time, spatial.features
    )

    for (const feature of spatialValues) {
      features.push({
        type: ''Feature'',
        geometry: feature.geometry,
        properties: {
          portId: feature.properties.portId,
          portName: feature.properties.portName,
          value: feature.properties.value,
          reliability: feature.properties.reliability,
        },
      })
    }
  }

  return { indicator: computed.indicator, unit: computed.unit, time, type: ''FeatureCollection'', features }
}

export async function getPortData(portId, indicator, start, end) {
  const indicators = indicator
    ? [indicator]
    : [''throughput'', ''berth'', ''traffic'', ''pressure'']
  const result = { portId, portName: '''', indicators: {} }

  for (const ind of indicators) {
    const computed = await getOrComputeForecast(ind, 1.0)
    const port = computed.ports[portId]
    if (!port) continue

    if (!result.portName) result.portName = port.portName

    let historical = port.historical
    let forecast = port.forecast
    if (start) {
      historical = historical.filter((d) => d.time >= start)
      forecast = forecast.filter((d) => d.time >= start)
    }
    if (end) {
      historical = historical.filter((d) => d.time <= end)
      forecast = forecast.filter((d) => d.time <= end)
    }

    result.indicators[ind] = { unit: computed.unit, historical, forecast }
  }

  return result
}

export async function getIndicatorData(type, time, portId, scenarioLevel = 1.0) {
  const computed = await getOrComputeForecast(type, scenarioLevel)
  const result = { indicator: computed.indicator, unit: computed.unit, ports: {} }
  const ports = portId ? [portId] : Object.keys(computed.ports)

  for (const pid of ports) {
    const port = computed.ports[pid]
    if (!port) continue
    let value = null
    if (time) {
      const point =
        port.historical.find((d) => d.time === time) ||
        port.forecast.find((d) => d.time === time)
      value = point?.value || null
    }
    result.ports[pid] = {
      portName: port.portName,
      value,
      historical: port.historical,
      forecast: port.forecast,
    }
  }

  return result
}

export async function getTimeSeriesData(indicator, portId, start, end, granularity, scenarioLevel = 1.0) {
  const computed = await getOrComputeForecast(indicator, scenarioLevel)
  const ports = portId ? [portId] : Object.keys(computed.ports)
  const series = []

  for (const pid of ports) {
    const port = computed.ports[pid]
    if (!port) continue
    let allData = [...port.historical, ...port.forecast]
    if (start) allData = allData.filter((d) => d.time >= start)
    if (end) allData = allData.filter((d) => d.time <= end)

    if (granularity === ''year'') {
      const yearly = {}
      allData.forEach((d) => {
        const y = d.time.split(''-'')[0]
        if (!yearly[y]) yearly[y] = { time: y, value: 0, count: 0, type: d.type }
        yearly[y].value += d.value
        yearly[y].count++
      })
      allData = Object.values(yearly).map((d) => ({
        time: d.time,
        value: Math.round(d.value / d.count),
        type: d.type,
      }))
    }

    series.push({ portId: pid, portName: port.portName, data: allData })
  }

  return { indicator: computed.indicator, unit: computed.unit, granularity: granularity || ''month'', series }
}
```

## server/services/importanceMapping.js

```javascript
const IMPORTANCE_FACTOR = {
  1: 0.4,
  2: 0.7,
  3: 1.0,
  4: 1.5,
  5: 2.2,
}

// FIX:P3-10: 非表项输入取整夹取并告警，拒绝静默兜底
function importanceToFactor(importance) {
  const raw = Number(importance)
  const n = Math.round(raw)
  if (!isFinite(raw) || n < 1 || n > 5) {
    console.warn(`[importanceMapping] 无效 importance: ${importance}，已按 3 处理``)
    return IMPORTANCE_FACTOR[3]
  }
  if (n !== raw) {
    console.warn(``[importanceMapping] importance ${importance} 非整数，已取整为 ${n}``)
  }
  return IMPORTANCE_FACTOR[n]
}

export function importanceToRadius(defaultRadius, importance) {
  const factor = importanceToFactor(importance)
  return Math.round(defaultRadius * factor * 10) / 10
}
```

## server/services/scoringService.js

```javascript
import * as turf from '@turf/turf''
import { linearDecay } from ''./decayFunctions.js''

export const DEFAULT_WEIGHTS = {
  hospital: 1.2,
  primary_school: 1.0,
  middle_school: 1.0,
  park: 0.8,
  bus_station: 0.6,
  mall: 0.7,
}
function distanceScore(xq, points, maxDistanceKm, decayFn) {
  if (!points || points.length === 0) return 0
  const xqPoint = turf.point([xq.lng, xq.lat])
  // FIX:P3-08: 循环求最小值，避免大数组 spread 栈溢出
  let nearest = Infinity
  for (const p of points) {
    const d = turf.distance(xqPoint, turf.point([p.lng, p.lat]), { units: ''kilometers'' })
    if (d < nearest) nearest = d
  }
  return decayFn(nearest, maxDistanceKm)
}
export function scoreXiaoqu(
  xiaoquList,
  facilityData,
  typeSettings,
  weights = DEFAULT_WEIGHTS,
  decayFn = linearDecay,
) {
  return xiaoquList.map((xq) => {
    let totalScore = 0
    let totalWeight = 0
    const breakdown = {}

    Object.entries(typeSettings).forEach(([key, setting]) => {
      if (!setting.selected) return
      const weight = weights[key] ?? 1
      const score = distanceScore(xq, facilityData[key], setting.radius, decayFn)
      breakdown[key] = Math.round(score * 10) / 10
      totalScore += score * weight
      totalWeight += weight
    })
    const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0
    return { ...xq, score: Math.round(finalScore * 10) / 10, breakdown }
  })
}
```

## server/services/siteAnalysisService.js

```javascript
import * as turf from '@turf/turf''
import { scoreXiaoqu, DEFAULT_WEIGHTS } from ''./scoringService.js''
import { linearDecay } from ''./decayFunctions.js''
import { importanceToRadius } from ''./importanceMapping.js''
import { createSpatialIndex, queryByPolygon } from ''../utils/spatialIndex.js''

const TOP_N = 10

export function validateSelection(selectedKeys) {
  if (!selectedKeys || selectedKeys.length === 0) {
    return ''请至少选择一种设施类型''
  }
  return null
}
export function resolveRadiusSettings(selectedKeys, typeSettings) {
  const resolved = {}
  selectedKeys.forEach((key) => {
    const setting = typeSettings[key]
    const radius = importanceToRadius(setting.defaultRadius, setting.importance)
    
    // FIX:106: 校验半径必须为正数
    if (radius <= 0 || isNaN(radius)) {
      // FIX:016 (错误): 仅在开发环境输出警告
      if (process.env.NODE_ENV === ''development'') {
        console.warn(`设施类型 ${key} 的缓冲区半径无效: ${radius}`)
      }
      // FIX:P1-08: 参数错误带码抛出，控制器据码返 400
      const err = new Error(`半径参数无效: ${radius}`)
      err.code = ''INVALID_PARAMS''
      throw err
    }
    
    resolved[key] = { selected: true, radius }
  })
  return resolved
}
export function buildTypeCoverage(points, radiusKm) {
  if (!points || points.length === 0) return null
  
  // FIX:315-001: 性能优化提示 - 大量POI数据建议实现聚类或空间索引
  if (points.length > 1000 && process.env.NODE_ENV === ''development'') {
    console.warn(`[性能优化] POI数据量较大(${points.length}条)，建议实现聚类或空间索引优化`)
  }
  
  // FIX:314-002: POI数据去重（基于坐标）
  const uniquePoints = []
  const seenCoords = new Set()
  for (const p of points) {
    const coordKey = `${p.lng},${p.lat}`
    if (!seenCoords.has(coordKey)) {
      seenCoords.add(coordKey)
      uniquePoints.push(p)
    }
  }
  
  // FIX:314-003: 过滤异常坐标[0,0]和不在北部湾范围内的坐标
  // 北部湾范围：经度 105-115，纬度 18-25
  const validPoints = uniquePoints.filter((p) => {
    const isValid = p && typeof p.lng === ''number'' && typeof p.lat === ''number'' && 
                    !isNaN(p.lng) && !isNaN(p.lat) &&
                    !(p.lng === 0 && p.lat === 0) && // 过滤[0,0]异常坐标
                    p.lng >= 105 && p.lng <= 115 && // 北部湾经度范围
                    p.lat >= 18 && p.lat <= 25      // 北部湾纬度范围
    // FIX:016 (错误): 仅在开发环境输出警告
    if (!isValid && process.env.NODE_ENV === ''development'') {
      console.warn(''无效的坐标点:'', p)
    }
    return isValid
  })
  
  if (validPoints.length === 0) {
    // FIX:016 (错误): 仅在开发环境输出警告
    if (process.env.NODE_ENV === ''development'') {
      console.warn(''没有有效的坐标点'')
    }
    return null
  }
  
  const buffers = validPoints.map((p) =>
    turf.buffer(turf.point([p.lng, p.lat]), radiusKm, { units: ''kilometers'' }),
  )
  
  // 过滤掉无效的缓冲区
  // FIX:GIS-004: 验证坐标数组长度
  const validBuffers = buffers.filter((b) => 
    b && b.geometry && b.geometry.coordinates && b.geometry.coordinates.length > 0
  )
  if (validBuffers.length === 0) {
    // FIX:016 (错误): 仅在开发环境输出警告
    if (process.env.NODE_ENV === ''development'') {
      console.warn(''没有有效的缓冲区'')
    }
    return null
  }
  
  if (validBuffers.length === 1) return validBuffers[0]
  
  try {
    const unionResult = turf.union(turf.featureCollection(validBuffers))
    // FIX:GIS-001: 验证 union 结果，处理 MultiPolygon 情况
    if (!unionResult || !unionResult.geometry) {
      if (process.env.NODE_ENV === ''development'') {
        console.warn(''union 返回无效结果'')
      }
      return null
    }
    
    // FIX:GIS-007: 如果返回 MultiPolygon，保留所有 Polygon 作为覆盖区域
    // 返回第一个 Polygon 作为主覆盖区域，但记录所有 Polygon 的坐标
    if (unionResult.geometry.type === ''MultiPolygon'') {
      if (process.env.NODE_ENV === ''development'') {
        console.warn(''turf.union 返回 MultiPolygon，保留所有 Polygon'')
      }
      // 返回完整的 MultiPolygon，而不是只返回第一个
      return unionResult
    }
    
    return unionResult
  } catch (error) {
    if (process.env.NODE_ENV === ''development'') {
      console.error(''turf.union 失败:'', error.message)
      console.error(''缓冲区数量:'', validBuffers.length)
    }
    return null
  }
}
export function intersectCoverages(coverages, selectedKeys) {
  const entries = coverages
    .map((c, i) => ({ key: selectedKeys[i], coverage: c }))
    .filter((e) => e.coverage && e.coverage.geometry)
  
  if (entries.length === 0) return { area: null, failKey: null }
  
  let result = entries[0].coverage
  
  for (let i = 1; i < entries.length; i++) {
    try {
      // 验证输入几何对象
      if (!result.geometry || !result.geometry.coordinates || 
          !entries[i].coverage.geometry || !entries[i].coverage.geometry.coordinates) {
        // FIX:016 (错误): 仅在开发环境输出警告
        if (process.env.NODE_ENV === ''development'') {
          console.warn(`无效的几何对象，跳过 ${entries[i].key}`)
        }
        continue
      }
      
      const intersectResult = turf.intersect(
        turf.featureCollection([result, entries[i].coverage])
      )
      
      if (!intersectResult || !intersectResult.geometry) {
        return { area: null, failKey: entries[i].key }
      }
      
      result = intersectResult
    } catch (error) {
      // FIX:016 (错误): 仅在开发环境输出错误
      if (process.env.NODE_ENV === ''development'') {
        console.error(`turf.intersect 失败 (${entries[i].key}):`, error.message)
      }
      return { area: null, failKey: entries[i].key }
    }
  }
  
  return { area: result, failKey: null }
}
export function filterMatchedXiaoqu(xiaoquData, finalArea, spatialIndex = null) {
  // FIX:314-001: 检查 xiaoquData 是否为空或 null
  if (!xiaoquData || xiaoquData.length === 0) {
    // FIX:016 (错误): 仅在开发环境输出警告
    if (process.env.NODE_ENV === ''development'') {
      console.warn(''小区数据为空'')
    }
    return []
  }
  
  const candidates = spatialIndex ? queryByPolygon(spatialIndex, finalArea) : xiaoquData
  
  // FIX:314-004: 验证 GeoJSON Feature 完整性
  return candidates.filter((xq) => {
    // 检查必要字段
    if (!xq || typeof xq.lng !== ''number'' || typeof xq.lat !== ''number'') {
      // FIX:016 (错误): 仅在开发环境输出警告
      if (process.env.NODE_ENV === ''development'') {
        console.warn(''小区数据缺少坐标字段:'', xq)
      }
      return false
    }
    // 检查坐标有效性
    if (isNaN(xq.lng) || isNaN(xq.lat) || xq.lng < -180 || xq.lng > 180 || xq.lat < -90 || xq.lat > 90) {
      // FIX:016 (错误): 仅在开发环境输出警告
      if (process.env.NODE_ENV === ''development'') {
        console.warn(''小区坐标无效:'', xq)
      }
      return false
    }
    // FIX:314-003: 检查坐标是否在北部湾业务区域内（经度 105-115，纬度 18-25）
    if (xq.lng < 105 || xq.lng > 115 || xq.lat < 18 || xq.lat > 25) {
      if (process.env.NODE_ENV === ''development'') {
        console.warn(''小区坐标不在北部湾业务区域内:'', xq)
      }
      return false
    }
    try {
      return turf.booleanPointInPolygon(turf.point([xq.lng, xq.lat]), finalArea)
    } catch (error) {
      // FIX:016 (错误): 仅在开发环境输出警告
      if (process.env.NODE_ENV === ''development'') {
        console.warn(''空间判断失败:'', error.message, xq)
      }
      return false
    }
  })
}
export function rankXiaoqu(matched, facilityData, radiusSettings, weights) {
  const scored = scoreXiaoqu(matched, facilityData, radiusSettings, weights, linearDecay)
  return scored.sort((a, b) => b.score - a.score).slice(0, TOP_N)
}
/**
 * 筛选覆盖范围内的设施POI
 * @param {Object} facilityData - 设施数据 { type: [{lng, lat, name}] }
 * @param {Object} finalArea - 覆盖范围 GeoJSON
 * @param {Array} selectedKeys - 选中的设施类型
 * @returns {Object} 各类型设施POI { type: [{lng, lat, name}] }
 */
export function filterFacilitiesInCoverage(facilityData, finalArea, selectedKeys) {
  const result = {}
  selectedKeys.forEach((key) => {
    const points = facilityData[key]
    if (!points || points.length === 0) {
      result[key] = []
      return
    }
    result[key] = points.filter((p) => {
      if (!p || typeof p.lng !== ''number'' || typeof p.lat !== ''number'') return false
      return turf.booleanPointInPolygon(turf.point([p.lng, p.lat]), finalArea)
    })
  })
  return result
}

export function runSiteAnalysis({
  selectedKeys,
  typeSettings,
  facilityData,
  xiaoquData,
  weights,
}) {
  // null 不会触发默认参数，需显式处理
  const finalWeights = weights || DEFAULT_WEIGHTS
  const validationError = validateSelection(selectedKeys)
  if (validationError) {
    return { error: validationError, coverage: null, matchedXiaoqu: [], facilityPoi: {} }
  }

  const radiusSettings = resolveRadiusSettings(selectedKeys, typeSettings)

  const coverages = selectedKeys.map((key) =>
    buildTypeCoverage(facilityData[key], radiusSettings[key].radius),
  )

  const { area: finalArea, failKey } = intersectCoverages(coverages, selectedKeys)
  if (!finalArea) {
    return {
      error: `${failKey} 的覆盖范围与其他类型无重叠区域`,
      coverage: null,
      matchedXiaoqu: [],
      facilityPoi: {},
    }
  }
  const spatialIndex = createSpatialIndex(xiaoquData)
  const matched = filterMatchedXiaoqu(xiaoquData, finalArea, spatialIndex)
  const top = rankXiaoqu(matched, facilityData, radiusSettings, finalWeights)

  // 筛选覆盖范围内的设施POI
  const facilityPoi = filterFacilitiesInCoverage(facilityData, finalArea, selectedKeys)

  return { error: null, coverage: finalArea, matchedXiaoqu: top, facilityPoi }
}
```

## 后端 - 工具类

## server/utils/fileStore.js

```javascript
import fs from 'fs/promises''

export function createFileStore(filePath, { useCache = true } = {}) {
  let cache = null
  let writeLock = Promise.resolve()

  function sequential(fn) {
    const next = writeLock.then(fn, fn)
    writeLock = next.then(() => {}, () => {})
    return next
  }

  async function readAll() {
    if (useCache && cache !== null) return cache
    try {
      const content = await fs.readFile(filePath, ''utf-8'')
      const data = JSON.parse(content)
      if (useCache) cache = data
      return data
    } catch (error) {
      if (error.code === ''ENOENT'') {
        if (useCache) cache = []
        return []
      }
      throw error
    }
  }

  async function writeAll(data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), ''utf-8'')
    if (useCache) cache = data
  }

  return { sequential, readAll, writeAll }
}
```

## server/utils/spatialIndex.js

```javascript
import RBush from 'rbush''

export function createSpatialIndex(xiaoquData) {
  const tree = new RBush()
  const items = xiaoquData.map((xq) => ({
    minX: xq.lng,
    minY: xq.lat,
    maxX: xq.lng,
    maxY: xq.lat,
    data: xq,
  }))
  tree.load(items)
  return tree
}

export function queryByPolygon(tree, polygon) {
  const bbox = getPolygonBBox(polygon)
  return tree.search(bbox).map((item) => item.data)
}

function getPolygonBBox(polygon) {
  const { type, coordinates } = polygon.geometry
  const polygons = type === ''MultiPolygon'' ? coordinates : [coordinates]
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  
  for (const poly of polygons) {
    // FIX:GIS-006: 验证 poly[0] 存在性
    if (!poly || !poly[0] || poly[0].length === 0) continue
    
    // FIX:GIS-005: 遍历所有环（外环 + 内环）
    for (const ring of poly) {
      if (!Array.isArray(ring)) continue
      for (const [x, y] of ring) {
        if (typeof x !== ''number'' || typeof y !== ''number'') continue
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
    }
  }
  
  // FIX:GIS-005: 如果没有有效坐标，返回默认 BBox
  if (minX === Infinity) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  }
  
  return { minX, minY, maxX, maxY }
}
```

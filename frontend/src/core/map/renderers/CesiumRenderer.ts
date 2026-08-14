// Cesium 3D 渲染器：Viewer 单例复用 + 按需挂载（30s 空闲自动销毁）。
// 图层/水面/地形/相机/事件等能力以模块级函数组织（本文件下方分区），经 renderer 实例委托调度。
import {
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  CesiumTerrainProvider,
  ClassificationType,
  Color,
  ColorGeometryInstanceAttribute,
  EllipsoidTerrainProvider,
  Entity,
  EntityCollection,
  GeographicTilingScheme,
  GeoJsonDataSource,
  DataSource,
  ImageryLayer,
  ScreenSpaceEventHandler,
  GeometryInstance,
  HeightReference,
  Math as CesiumMath,
  PerInstanceColorAppearance,
  PointGraphics,
  PolygonGeometry,
  PolygonHierarchy,
  Primitive,
  Rectangle,
  sampleTerrain,
  ScreenSpaceEventType,
  SingleTileImageryProvider,
  UrlTemplateImageryProvider,
  Viewer,
} from 'cesium'
import type { FeatureCollection } from 'geojson'

import { buildTiandituUrl, MAP_CONFIG, zoomToHeight } from '@/core/config/map'
import type { IndexedItem } from '@/shared'
import { createSpatialIndex, LAYER_DEFAULTS } from '@/shared'
import { logger } from '@/shared'
import { normalizePoint } from '@/shared'
import type {
  CameraState,
  FlyToOptions,
  FlyToTarget,
  LayerOptions,
  PointFeature,
  PolygonFeature,
  WaterSurfaceOptions,
} from '@/types'

import { MapRenderer, type LayerState } from './MapRenderer'

/** 相机默认俯仰角（度）：-90° 俯视（z076 提取；引擎切换刻意不传递倾斜状态——OL 无 pitch 概念） */
const DEFAULT_CAMERA_PITCH_DEG = -90

// CesiumViewer单例：全局唯一Viewer，按需mount/unmount复用，30s空闲自动销毁
class CesiumViewerManager {
  viewer: Viewer | null
  isMounted: boolean
  _baseLayersInitialized: boolean
  _idleDestroyTimer: ReturnType<typeof setTimeout> | null
  IDLE_DESTROY_DELAY: number
  _baseLayers: { image: unknown[]; vector: unknown[] }

  constructor() {
    this.viewer = null
    this.isMounted = false
    this._baseLayersInitialized = false
    this._idleDestroyTimer = null
    this.IDLE_DESTROY_DELAY = 30000
    this._baseLayers = { image: [], vector: [] }
  }

  // 首次创建Viewer，后续调用返回已有实例
  create(container: HTMLElement): Viewer | null {
    this._clearIdleDestroyTimer()

    if (this.viewer) {
      return this.viewer
    }

    this.viewer = new Viewer(container, {
      baseLayer: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      homeButton: false,
      // 默认 geocoder 启用会发 Ion 请求（公网依赖+隐私），显式关闭
      geocoder: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      timeline: false,
      animation: false,
      // requestRenderMode 按需渲染：静止零开销，图层/水面/相机防抖/动画等动态路径均已显式 requestRender
      // 关 HDR/FXAA/抗锯齿：240Hz 屏每帧预算约 6ms，后处理是拖拽掉帧的主要 GPU 开销
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
      // cesium 类型未收录 highDynamicRange/fxaa（版本差异），结构化断言保留运行期行为
    } as unknown as ConstructorParameters<typeof Viewer>[1])

    // maximumScreenSpaceError 4（默认 2）：globe 网格减半，拖拽更流畅（远处地形略简，视觉可接受）
    ;(this.viewer.scene as unknown as { maximumScreenSpaceError: number }).maximumScreenSpaceError =
      4
    // 关大气地面散射与雾（240Hz 下每帧计算的视觉开销，非业务必需）
    this.viewer.scene.globe.showGroundAtmosphere = false
    this.viewer.scene.fog.enabled = false

    this.isMounted = true
    return this.viewer
  }

  mount(el: HTMLElement): boolean {
    if (!this.viewer) {
      return false
    }

    if (!el) {
      return false
    }

    // 清除空闲销毁定时器（用户回来了）
    this._clearIdleDestroyTimer()

    const viewerContainer = this.viewer.container

    // viewerContainer 即 el 本身：已在正确位置，仅刷新
    if (viewerContainer === el) {
      this.isMounted = true
      this.viewer.resize()
      // 保持按需渲染（曾无条件持续渲染致 240Hz 屏静止时 GPU 空转掉帧），仅刷新当前帧
      this.viewer.scene.requestRender()
      this._enableCameraControls()
      return true
    }

    // viewerContainer 父节点不是 el：移动到新容器
    if (viewerContainer && viewerContainer.parentNode !== el) {
      el.appendChild(viewerContainer)
    }

    // 无论是否移动 DOM，都重置状态，防止复用时的旧 unmount 状态影响交互
    this.isMounted = true
    this.viewer.resize()
    // 同上方：保持按需渲染，仅刷新当前帧
    this.viewer.scene.requestRender()
    // 确保相机控制器的交互能力正常（拖拽、旋转、缩放等）
    this._enableCameraControls()

    return true
  }

  /** 启用相机控制器全部交互（拖拽/旋转/缩放/倾斜），首次创建与每次挂载时调用防止状态被意外修改 */
  _enableCameraControls() {
    if (!this.viewer) return
    const controller = this.viewer.scene.screenSpaceCameraController
    controller.enableRotate = true
    controller.enableTranslate = true
    controller.enableZoom = true
    controller.enableTilt = true
    controller.enableLook = true
  }

  /** 从 DOM 卸载（不销毁 Viewer 保留状态）：暂停渲染降 GPU 占用，并启动 30s 空闲销毁定时器 */
  unmount() {
    if (!this.viewer || !this.isMounted) {
      return
    }

    this.isMounted = false
    // 暂停渲染，降低GPU占用（容器由 Vue v-show 隐藏为 display:none，此处停止渲染循环即可）
    this.viewer.scene.requestRenderMode = true
    // 启动空闲销毁定时器（30秒后自动销毁释放内存）
    this._startIdleDestroyTimer()
  }

  /** 30s 空闲后自动销毁 Viewer 释放内存 */
  _startIdleDestroyTimer() {
    this._clearIdleDestroyTimer()
    this._idleDestroyTimer = setTimeout(() => {
      logger.debug('[CesiumViewerManager] 30秒空闲，自动销毁Viewer释放内存')
      this.destroy()
    }, this.IDLE_DESTROY_DELAY)
  }

  /** 清除空闲销毁定时器 */
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

  /** 标记底图已初始化 */
  markBaseLayersInitialized() {
    this._baseLayersInitialized = true
  }

  /** 设置底图引用（供复用的新 CesiumRenderer 实例获取，替代直写私有字段） */
  setBaseLayers(layers: { image: unknown[]; vector: unknown[] }): void {
    this._baseLayers = layers
  }

  /** 获取底图引用 */
  getBaseLayers() {
    return this._baseLayers || null
  }

  /** 真正销毁 Viewer（常规卸载不调用，保留复用语义） */
  destroy() {
    if (this.viewer) {
      this.unmount()
      this.viewer.destroy()
      this.viewer = null
      this._baseLayersInitialized = false
    }
  }

  /** 显式销毁 Viewer（仅应用退出/HMR/测试场景；常规卸载走 unmount() 保留复用） */
  destroyViewer() {
    this._clearIdleDestroyTimer()
    this.destroy()
  }
}

// 全局单例管理器
export const cesiumViewerManager = new CesiumViewerManager()

/**
 * Cesium 3D 渲染器。
 * 单例 Viewer + 按需挂载：首次进入 3D 创建，离开仅 unmount，再进入复用状态保留。
 */
export class CesiumRenderer extends MapRenderer {
  viewer: Viewer | null
  baseLayers: { image: unknown[]; vector: unknown[] }
  _isReusing: boolean
  _cameraDebounceTimer: ReturnType<typeof setTimeout> | null
  _terrainReady: boolean
  _terrainProvider: CesiumTerrainProvider | null
  _terrainEnabled: boolean
  _hillshadeLayer: unknown
  _imageryErrorLogged: boolean
  _screenSpaceEventHandler: ScreenSpaceEventHandler | null
  _cameraChangedHandler: (() => void) | null
  _waterSurfaces: Map<string, WaterSurfaceEntry> | null
  _breathingEntity: unknown | null
  _breathingAnimId: number | null
  _breathingAnimation: unknown | null
  _geoJsonTokens: Map<string, symbol>

  constructor(container: HTMLElement) {
    super(container)
    this.viewer = null
    this.baseLayers = { image: [], vector: [] }
    this._isReusing = false // 标记是否复用已有 Viewer
    this._cameraDebounceTimer = null // 相机变化防抖定时器
    /** 真地形就绪标志：业务层据此跳过 hillshade 回退贴图（真地形 z 起伏 + Cesium 光照取代伪三维明暗图） */
    this._terrainReady = false
    /** 真地形 provider 引用（setTerrainEnabled 切换用）；未就绪为 null */
    this._terrainProvider = null
    /** "真实地形"开关状态（3D 语义）：默认开，_setupTerrain 自动加载即显示 */
    this._terrainEnabled = true
    /** hillshade 回退贴图引用（DEM 独立图层，显隐由图层面板开关控制） */
    this._hillshadeLayer = null
    /** 底图瓦片失败 warn 只打一次（防每个瓦片刷屏） */
    this._imageryErrorLogged = false
    this._screenSpaceEventHandler = null
    this._cameraChangedHandler = null
    this._waterSurfaces = null
    this._breathingEntity = null
    this._breathingAnimId = null
    this._breathingAnimation = null
    this._geoJsonTokens = new Map()
    this._initViewer()
  }

  _initViewer() {
    // 复用场景判断（单例已存在）
    const existingViewer = cesiumViewerManager.getInstance()
    this._isReusing = !!existingViewer

    // 经单例管理器创建或获取 Viewer
    this.viewer = cesiumViewerManager.create(this.container)

    // create() 在 Viewer 已存在时直接返回、不会自动挂载，复用场景须显式 mount 到新容器
    if (this._isReusing) {
      cesiumViewerManager.mount(this.container)
    }

    // 仅首次创建时初始化场景
    if (!this._isReusing) {
      this._positionCamera()
      this._initBaseLayers()
      // 真 3D 地形：CesiumTerrainProvider 按需 LOD 加载 CTB（地形金字塔切片工具）预切瓦片，
      // 成功置 _terrainReady → hillshade 回退退场；失败静默降级为全量贴图（不阻塞 Viewer）
      void this._setupTerrain()
    } else {
      // 复用实例从单例管理器取底图引用
      this.baseLayers = cesiumViewerManager.getBaseLayers()
    }

    // 事件处理器绑定到当前实例，每次挂载都要重新绑定
    this._setupClickHandler()

    // 首次创建与复用都必须启用相机控制与缩放限位，否则复用后交互可能失效
    this._setupZoomLimits()

    // 相机变化 300ms 防抖，避免移动时频繁渲染与状态同步
    this._setupCameraDebounce()
  }

  /** 相机变化 300ms 防抖后触发渲染与状态同步（避免拖拽/缩放中频繁更新，降低 CPU/GPU 负载） */
  _setupCameraDebounce() {
    // 委托至模块级函数（本文件下方）
    setupCameraDebounce(this)
  }

  _setupZoomLimits(): void {
    const viewer = this.viewer
    if (!viewer) return
    const controller = viewer.scene.screenSpaceCameraController
    controller.minimumZoomDistance = 100
    controller.maximumZoomDistance = 500000
    // 显式启用相机控制器全部交互（拖拽/旋转/缩放/倾斜）
    controller.enableRotate = true
    controller.enableTranslate = true
    controller.enableZoom = true
    controller.enableTilt = true
    controller.enableLook = true
  }

  /** 真地形接入：/static/terrain/ 目录 → CesiumTerrainProvider。失败静默降级（不阻塞 Viewer）。 */
  async _setupTerrain() {
    try {
      const viewer = this.viewer
      if (!viewer) return
      // fromUrl 将传入 URL 视为目录并拼接 layer.json（传文件 URL 会拼错 404），必须传目录 URL
      const provider = await CesiumTerrainProvider.fromUrl('/static/terrain/', {
        // CTB（地形金字塔切片工具）输出 gzip 压缩流，Cesium 自动识别解压，无需服务器声明编码
        requestVertexNormals: true,
      })
      // viewer 可能已被 30s 闲置销毁，销毁后属性清空访问即崩
      if (!viewer || !viewer.scene || viewer.isDestroyed()) return
      this._terrainProvider = provider
      this._terrainReady = true
      // 用户若关过"真实地形"开关则保持椭球面，等 setTerrainEnabled(true) 再启用（状态延续）
      if (this._terrainEnabled !== false) {
        viewer.terrainProvider = provider
      }
      // 不自动隐藏 hillshade：DEM（数字高程模型）是独立图层，显隐由图层面板开关控制
      viewer.scene.requestRender()
      logger.debug('[CesiumRenderer] 真地形接入成功: /static/terrain/layer.json')
    } catch (e) {
      // 加载失败保持椭球面 + hillshade 回退，记录原因便于排查（常见：dev 未重启 / 后端未起 / 瓦片目录缺失）
      logger.warn('[CesiumRenderer] 真地形接入跳过:', e instanceof Error ? e.message : e)
    }
  }

  /**
   * "真实地形"开关的 3D 语义：切换 terrainProvider（开=CTB 真地形 z 起伏，关=平坦椭球面）。
   * 3D 下 geotiff 图层无独立实例（真地形已由 provider 呈现，addGeoTIFFLayer 在 _terrainReady
   * 时跳过），开关由 layerAdapters.geotiff.setVisibility 在 3D 下调用。
   * z105：@arch-note 预留钩子——当前无调用方（layerAdapters geotiff 走普通图层显隐语义，
   * 不做 terrainProvider 特殊处理）；L350 状态延续逻辑依赖本方法，保留待"真实地形"UI 开关接线。
   */
  setTerrainEnabled(enabled: boolean): void {
    this._terrainEnabled = enabled
    if (!this.viewer || !this.viewer.scene || this.viewer.isDestroyed()) return
    // provider 未就绪时无可切换，等 _setupTerrain 成功后再按开关生效
    if (!this._terrainProvider) return
    this.viewer.terrainProvider = enabled ? this._terrainProvider : new EllipsoidTerrainProvider()
    this.viewer.scene.requestRender()
  }

  _positionCamera(): void {
    const viewer = this.viewer
    if (!viewer) return
    viewer.scene.globe.enableLighting = true
    // 保持默认远视角（不定位），后续 flyTo 飞向目标产生"地球飞转"加载动画，避免 OL→Cesium 切换闪屏
  }

  _initBaseLayers(): void {
    // 防止重复初始化底图
    if (cesiumViewerManager.isBaseLayersInitialized()) {
      return
    }
    const viewer = this.viewer
    if (!viewer) return

    // errorEvent 在 ImageryProvider 上而非 ImageryLayerCollection（挂后者抛 TypeError 致 3D 初始化失败）；首次失败 warn 一次
    // F-5：回调提为具名函数便于将来显式移除；provider 生命周期与图层绑定（随图层销毁，无独立泄漏路径）
    const imageryErrorHandler = (err: unknown) => {
      if (this._imageryErrorLogged) return
      this._imageryErrorLogged = true
      logger.warn(
        '[CesiumRenderer] 底图瓦片加载失败（首次）:',
        err instanceof Error ? err.message : err
      )
    }
    const attachImageryErrorLog = (provider: UrlTemplateImageryProvider) => {
      if (!provider?.errorEvent) return
      provider.errorEvent.addEventListener(imageryErrorHandler)
    }

    // UrlTemplateImageryProvider 不识别 {layerCode}/{key} 占位符（原样发送致天地图请求失败底图空白，
    // OL 自实现模板替换所以正常），须预替换为字面值
    const tiandituUrlForCesium = (layerCode: string) =>
      buildTiandituUrl(layerCode)
        .replace('{layerCode}', layerCode)
        .replace('{key}', MAP_CONFIG.TIANDITU_KEY)

    const imageBaseProvider = new UrlTemplateImageryProvider({
      url: tiandituUrlForCesium(MAP_CONFIG.BASE_LAYERS.image.layers[0]),
      maximumLevel: 18,
    })
    attachImageryErrorLog(imageBaseProvider)
    const imageBaseLayer = viewer.imageryLayers.addImageryProvider(imageBaseProvider)
    const imageAnnotationProvider = new UrlTemplateImageryProvider({
      url: tiandituUrlForCesium(MAP_CONFIG.BASE_LAYERS.image.layers[1]),
      maximumLevel: 18,
    })
    attachImageryErrorLog(imageAnnotationProvider)
    const imageAnnotationLayer = viewer.imageryLayers.addImageryProvider(imageAnnotationProvider)
    const vectorBaseProvider = viewer.imageryLayers.addImageryProvider(
      new UrlTemplateImageryProvider({
        url: tiandituUrlForCesium(MAP_CONFIG.BASE_LAYERS.vector.layers[0]),
        maximumLevel: 18,
      })
    )
    const vectorAnnotationProvider = viewer.imageryLayers.addImageryProvider(
      new UrlTemplateImageryProvider({
        url: tiandituUrlForCesium(MAP_CONFIG.BASE_LAYERS.vector.layers[1]),
        maximumLevel: 18,
      })
    )
    vectorBaseProvider.show = false
    vectorAnnotationProvider.show = false

    this.baseLayers.image = [imageBaseLayer, imageAnnotationLayer]
    this.baseLayers.vector = [vectorBaseProvider, vectorAnnotationProvider]

    // 底图引用存入单例管理器，供复用的新实例获取
    cesiumViewerManager.setBaseLayers({
      image: this.baseLayers.image,
      vector: this.baseLayers.vector,
    })

    cesiumViewerManager.markBaseLayersInitialized()
  }

  _setupClickHandler() {
    // 委托至模块级函数（本文件下方）
    setupClickHandler(this)
  }

  addPointLayer(id: string, features: PointFeature[], options: LayerOptions = {}): void {
    // 委托至模块级函数
    addPointLayer(this, id, features, options)
  }

  /** 构建 Cesium 点 Entity（含 label/properties），供点图层与视口裁剪复用（构建逻辑单一来源） */
  _createCesiumPointEntity(
    id: string,
    item: PointFeature,
    index: number,
    options: LayerOptions
  ): Entity | null {
    return createCesiumPointEntity(this, id, item, index, options)
  }

  /** 相机视口经纬度范围（简化估算）；注意 positionCartographic 为弧度，须 toDegrees 后与要素经纬度比较 */
  _getViewportBBox(): ViewportBBox | null {
    return getViewportBBox(this)
  }

  /** 点是否在视口内 */
  _isInViewport(lng: number, lat: number, bbox: ViewportBBox | null): boolean {
    return isInViewport(lng, lat, bbox)
  }

  /** 注册视口变化监听：相机移动时增量增删视口内外要素（requestAnimationFrame 防抖） */
  _setupViewportListener(id: string): void {
    setupViewportListener(this, id)
  }

  /** 视口变化时增量更新裁剪图层：移除出视口的 Entity，添加新进入的 */
  _updateCulledLayer(id: string): void {
    updateCulledLayer(this, id)
  }

  addPolygonLayer(id: string, features: PolygonFeature[], options: LayerOptions = {}): void {
    addPolygonLayer(this, id, features, options)
  }

  async addGeoJsonLayer(
    id: string,
    geojson: FeatureCollection,
    options: LayerOptions = {}
  ): Promise<void> {
    await addGeoJsonLayer(this, id, geojson, options)
  }

  /** 增量更新 GeoJSON 图层：复用 dataSource，避免重建闪烁 */
  async updateGeoJsonLayer(
    id: string,
    geojson: FeatureCollection,
    options: LayerOptions = {}
  ): Promise<void> {
    await updateGeoJsonLayer(this, id, geojson, options)
  }

  /**
   * 添加 GeoTIFF 栅格图层（3D 回退方案）：Cesium 影像不支持 GeoTIFF 解码，将 .tif 映射为
   * 预生成 hillshade PNG（WGS84 经纬度坐标系，EPSG:4326）贴椭球面——山体明暗观感，无真 z 起伏（伪三维）。
   * 与 2D 共用同一份 BusinessLayerManager 注册；2D↔3D 切换时由 App.vue 的 reapplyAll 重绘。
   */
  addGeoTIFFLayer(id: string, url: string, options: LayerOptions = {}): boolean {
    return addGeoTIFFLayer(this, id, url, options)
  }

  _doSetVisibility(id: string, visible: boolean): void {
    doSetVisibility(this, id, visible)
  }

  _doRemoveLayer(layer: { instance: unknown; visible: boolean; options?: LayerOptions }): void {
    doRemoveLayer(this, layer)
  }

  _doFlyTo(target: FlyToTarget, options: FlyToOptions = {}): void {
    const viewer = this.viewer
    if (viewer && 'layerId' in target && target.layerId) {
      const layer = this._layers.get(target.layerId)
      if (layer && layer.instance) {
        if (Array.isArray(layer.instance) && layer.instance.length > 0) {
          void viewer.flyTo(layer.instance[0] as Entity)
          return
        } else if ((layer.instance as { entities?: unknown }).entities) {
          void viewer.flyTo(layer.instance as EntityCollection)
          return
        }
      }
    }
    const height = options?.height ?? 5000
    // 防御性编程：优先使用 lng，兼容可能的 lon 字段
    const lng =
      (target as { lng?: number; lon?: number }).lng ?? (target as { lon?: number }).lon ?? 0
    const lat = (target as { lat: number }).lat
    const destination = Cartesian3.fromDegrees(lng, lat, height)
    viewer?.camera.flyTo({
      destination,
      // Cesium duration 单位为秒：读 FlyToOptions.duration ?? 默认 1
      duration: options.duration ?? 1,
      orientation: {
        heading: CesiumMath.toRadians(options.heading || 0),
        // 默认俯视 -90°（与 OL 2D 平坦视图一致），避免引擎切换时 pickEllipsoid 因倾斜产生偏移
        // z076：提为常量（刻意设计：引擎切换不传递倾斜状态，见 doSetCameraState 注释）
        pitch: CesiumMath.toRadians(options.pitch ?? DEFAULT_CAMERA_PITCH_DEG),
        roll: 0,
      },
    })
  }

  _getCameraState(): CameraState {
    const camera = this.viewer?.camera
    if (!camera) {
      return { center: { lng: MAP_CONFIG.CAMERA.center.lng, lat: MAP_CONFIG.CAMERA.center.lat } }
    }
    const posCartographic = camera.positionCartographic

    // 导出 pitch（恢复时用）
    const pitchDeg = CesiumMath.toDegrees(camera.pitch)

    // 优先取屏幕中心射线落点 pickEllipsoid（用户实际注视点，受 tilt 影响），失败回退相机正下方 positionCartographic
    const screenCenter = new Cartesian2(
      (this.viewer?.container.clientWidth ?? 0) / 2,
      (this.viewer?.container.clientHeight ?? 0) / 2
    )
    const cartesian = camera.pickEllipsoid(screenCenter)
    let center: { lng: number; lat: number }
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

    const state: CameraState = {
      center,
      height: posCartographic.height,
      pitch: pitchDeg,
    }

    logger.debug('[CesiumRenderer._getCameraState] 导出状态:', {
      center: state.center,
      height: state.height,
      heightKm: ((state.height ?? 0) / 1000).toFixed(2) + 'km',
      pitch: pitchDeg.toFixed(2) + '°',
      usingPick: cartesian !== null,
    })

    return state
  }

  _setCameraState(state: CameraState): void {
    logger.debug('[CesiumRenderer._setCameraState] 导入原始状态:', state)

    // 计算高度：优先使用 height，其次从 OL 的 zoom 转换
    let height = state.height
    if (height == null && state.zoom != null) {
      height = zoomToHeight(state.zoom)
    }
    if (height == null) {
      height = MAP_CONFIG.CAMERA.center.height
    }
    // 高度钳制 [200m, 2000km]：200m 避免贴地；上限对齐 VIEW_LEVELS.REGION 的 1600km（约 0.25 地球半径，视角安全）
    height = Math.max(200, Math.min(height, 2000000))

    // pitch 强制 -90° 俯视，不与 OL 之间传递倾斜状态（OL 无 pitch 概念）
    const pitch = -90

    logger.debug('[CesiumRenderer._setCameraState] 最终设置:', {
      center: state.center,
      height,
      heightKm: (height / 1000).toFixed(2) + 'km',
      pitch: pitch + '°',
    })

    const destination = Cartesian3.fromDegrees(state.center.lng, state.center.lat, height)

    // 从默认远视角飞向北部湾目标，3s 足够完成跨半球飞行又不显拖沓
    this.viewer?.camera.flyTo({
      destination,
      duration: 3.0,
      orientation: {
        heading: 0,
        pitch: CesiumMath.toRadians(pitch),
        roll: 0,
      },
    })
  }

  setBaseLayer(type: 'image' | 'vector'): void {
    this.baseLayers.image.forEach((l) => {
      if (l) {
        ;(l as { show: boolean }).show = type === 'image'
      }
    })
    this.baseLayers.vector.forEach((l) => {
      if (l) {
        ;(l as { show: boolean }).show = type === 'vector'
      }
    })
    this.viewer?.scene.requestRender()
  }

  startBreathing(lng: number, lat: number): void {
    this.stopBreathing()
    if (!this.viewer) return
    const startTime = Date.now()
    const center = Cartesian3.fromDegrees(lng, lat)
    // 预解析呼吸灯基准色（LAYER_DEFAULTS.color = '#409eff'，即 rgb(64,158,255)）
    const baseColor = Color.fromCssColorString(LAYER_DEFAULTS.color)
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
          return baseColor.withAlpha(alpha)
        }, false),
        outlineColor: Color.WHITE,
        outlineWidth: 2,
      },
    })
    this._breathingAnimation = () => {
      if (this._breathingEntity && this.viewer) {
        this.viewer.scene.requestRender()
        this._breathingAnimId = requestAnimationFrame(
          this._breathingAnimation as FrameRequestCallback
        )
      }
    }
    this._breathingAnimId = requestAnimationFrame(this._breathingAnimation as FrameRequestCallback)
  }

  stopBreathing(): void {
    if (this._breathingAnimId) {
      cancelAnimationFrame(this._breathingAnimId)
      this._breathingAnimId = null
    }
    if (this._breathingEntity && this.viewer) {
      this.viewer.entities.remove(this._breathingEntity as Entity)
      this._breathingEntity = null
    }
    this._breathingAnimation = null
  }

  // 水面方法委托至模块级函数（本文件下方）
  addWaterSurface(
    id: string,
    coordinates: [number, number][],
    height = 0,
    options: WaterSurfaceOptions = {}
  ): Promise<boolean> {
    return addWaterSurface(this, id, coordinates, height, options)
  }

  updateWaterLevel(id: string, newHeight: number): boolean {
    return updateWaterLevel(this, id, newHeight)
  }

  removeWaterSurface(id: string): boolean {
    return removeWaterSurface(this, id)
  }

  removeAllWaterSurfaces(): boolean {
    return removeAllWaterSurfaces(this)
  }

  setWaterSurfaceVisibility(id: string, visible: boolean): boolean {
    return setWaterSurfaceVisibility(this, id, visible)
  }

  /**
   * 覆写基类 hasLayer：水面存于 _waterSurfaces 而非 _layers，基类查不到会令 BLM（业务图层管理器）
   * 误判图层缺失而走 remove+add 全量重建，增量水位更新（替换 geometryInstances）永远走不到。
   */
  hasLayer(id: string): boolean {
    return super.hasLayer(id) || (this._waterSurfaces?.has(id) ?? false)
  }

  /** 覆写 isLayerVisible：水面可见性存于 _waterSurfaces（含 visible 字段），面板按钮据此读真实状态 */
  isLayerVisible(id: string): boolean {
    if (super.isLayerVisible(id)) return true
    const ws = this._waterSurfaces?.get(id)
    return ws ? ws.visible : false
  }

  getType() {
    // 返回 '3d'（与 MapType 一致；原因同 OLRenderer.getType）
    return '3d'
  }

  getViewer() {
    return this.viewer
  }

  updateSize() {
    this.viewer?.resize()
    this.viewer?.scene.requestRender()
  }

  /** 卸载但不销毁 Viewer 单例：仅从 DOM 移除，保留实例供下次复用 */
  destroy() {
    // 清理事件监听（相机监听 + 屏幕事件处理器）
    destroyEvents(this)

    // 清理水面图层 Map，防止内存泄漏
    if (this._waterSurfaces) {
      this.removeAllWaterSurfaces()
      this._waterSurfaces = null
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

  /** 显式真正销毁 Viewer（仅测试/HMR/应用退出；常规卸载走 destroy() 保留复用语义） */
  destroyViewer() {
    cesiumViewerManager.destroyViewer()
    this.viewer = null
  }
}

// ===== 事件：相机防抖 / 点击 / 指针移动（模块级函数，经 renderer 实例委托） =====
/**
 * 事件管理：click / pointer-move / camera-changed 的注册与清理。
 * 处理器引用存于 renderer 实例（_screenSpaceEventHandler / _cameraChangedHandler），供 destroy 注销。
 */

/** Cartesian3 → [lng, lat]（角度制） */
export function cartesianToLonLatArray(cartesian: Cartesian3): [number, number] {
  const cartographic = Cartographic.fromCartesian(cartesian)
  return [CesiumMath.toDegrees(cartographic.longitude), CesiumMath.toDegrees(cartographic.latitude)]
}

/** 相机变化 300ms 防抖：之后触发渲染与 camera-changed 回传（避免拖拽/缩放中频繁更新） */
export function setupCameraDebounce(renderer: CesiumRenderer): void {
  const DEBOUNCE_DELAY = 300
  // 保存监听器引用，供 destroy 移除，防止泄漏与 TypeError
  renderer._cameraChangedHandler = () => {
    // 清除之前的防抖定时器
    if (renderer._cameraDebounceTimer) {
      clearTimeout(renderer._cameraDebounceTimer)
    }
    renderer._cameraDebounceTimer = setTimeout(() => {
      // viewer 可能已置空，防御
      if (renderer.viewer!) {
        renderer.viewer!.scene.requestRender()
        // 相机变化防抖后回传状态（复用 _cameraChangedHandler，勿新增监听）
        renderer.emit('camera-changed', renderer._getCameraState())
      }
      renderer._cameraDebounceTimer = null
    }, DEBOUNCE_DELAY)
  }
  renderer.viewer!.camera.changed.addEventListener(renderer._cameraChangedHandler)
}

/** 点击/移动监听：LEFT_CLICK 拾取要素 properties 并 emit click；MOUSE_MOVE 回传鼠标经纬度 */
export function setupClickHandler(renderer: CesiumRenderer): void {
  renderer._screenSpaceEventHandler = renderer.viewer!.screenSpaceEventHandler
  const handler = renderer._screenSpaceEventHandler
  if (!handler) return
  // Cesium 拾取事件载荷：{ position: Cartesian2 }（LEFT_CLICK）/ { endPosition }（MOUSE_MOVE）
  handler.setInputAction((click: { position: Cartesian2 }) => {
    const pickedObject = renderer.viewer!.scene.pick(click.position)
    const cartesian = renderer.viewer!.camera.pickEllipsoid(click.position)
    const coordinate = cartesian ? cartesianToLonLatArray(cartesian) : null

    if (pickedObject && pickedObject.id && pickedObject.id.properties) {
      const properties = pickedObject.id.properties.getValue?.() || pickedObject.id.properties
      const featureType = properties.featureType
      if (featureType) {
        renderer.emit('click', {
          featureType,
          data: properties,
          coordinate,
        })
        return
      }
    }
    renderer.emit('click', {
      featureType: null,
      data: null,
      coordinate,
    })
  }, ScreenSpaceEventType.LEFT_CLICK)

  // pointer-move 事件（对应 MapRendererEventMap 声明）
  handler.setInputAction((movement: { endPosition: Cartesian2 }) => {
    const cartesian = renderer.viewer!.camera.pickEllipsoid(
      movement.endPosition,
      renderer.viewer!.scene.globe.ellipsoid
    )
    if (cartesian) {
      const carto = Cartographic.fromCartesian(cartesian)
      renderer.emit('pointer-move', {
        lng: CesiumMath.toDegrees(carto.longitude),
        lat: CesiumMath.toDegrees(carto.latitude),
      })
    }
  }, ScreenSpaceEventType.MOUSE_MOVE)
}

/** 移除相机变化监听与屏幕事件处理器（LEFT_CLICK/MOUSE_MOVE），供 destroy 调用 */
export function destroyEvents(renderer: CesiumRenderer): void {
  // 移除相机监听器
  if (renderer.viewer && renderer._cameraChangedHandler) {
    renderer.viewer!.camera.changed.removeEventListener(renderer._cameraChangedHandler)
    renderer._cameraChangedHandler = null
  }

  // 清理屏幕事件处理器，防止内存泄漏
  if (renderer._screenSpaceEventHandler) {
    renderer._screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_CLICK)
    renderer._screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.MOUSE_MOVE)
    renderer._screenSpaceEventHandler = null
  }
}

// ===== 图层：点/多边形/GeoJSON/GeoTIFF 注册与移除 =====
/**
 * 图层管理：entity / dataSource / imageryLayer 的添加、移除与可见性切换。
 * 状态存于 renderer._layers；视口裁剪、异步竞态等跨模块依赖经 renderer 实例委托。
 */

/** 添加点图层：Entity 数超阈值时启用视口裁剪，仅渲染视口内要素 */
export function addPointLayer(
  renderer: CesiumRenderer,
  id: string,
  features: PointFeature[],
  options: LayerOptions = {}
): void {
  // 幂等：先清除同 id 旧图层，防止 Entity 累积 + 相机监听器泄漏
  const existing = renderer._layers.get(id)
  if (existing) renderer._doRemoveLayer(existing)

  // 视口裁剪本身无条件生效（下方 _getViewportBBox + _isInViewport 过滤）；
  // DEV 仅控制诊断日志输出（2026-08-11 澄清：非功能门控）
  const totalEntities = renderer.viewer!.entities.values.length + features.length
  if (totalEntities > 1000 && import.meta.env.DEV) {
    logger.debug(`[CesiumRenderer] Entity数量(${totalEntities})超过1000，启动视口裁剪`)
  }

  // 视口裁剪：仅添加当前视口内的点
  const bbox = renderer._getViewportBBox()

  const entities: Entity[] = []
  features.forEach((item: PointFeature, index: number) => {
    // 坐标归一化走 normalizePoint（含 longitude 别名）；缺失坐标跳过该要素（不落 (0,0) 哨兵）
    const point = normalizePoint(item)
    if (!point) return
    const { lng, lat } = point
    if (bbox && !renderer._isInViewport(lng, lat, bbox)) return
    const entity = createCesiumPointEntity(renderer, id, item, index, options)
    if (entity) entities.push(entity)
  })

  if (entities.length === 0 && import.meta.env.DEV) {
    logger.debug(`[CesiumRenderer] 图层 ${id} 视口内无可见要素（总 ${features.length} 个）`)
  }

  renderer._layers.set(id, {
    instance: entities,
    visible: true,
    options,
    // 保存原始 features 供视口变化时增量更新
    allFeatures: features,
    // 空间索引（W4-17）：相机移动增量更新时按视口 bbox 查询候选，替代全量遍历 O(N)
    _spatialIndex: buildPointSpatialIndex(features),
  })
  renderer._applyPendingVisibility(id)
  // 触发渲染
  renderer.viewer!.scene.requestRender()

  // 注册相机变化监听，视口变化时增量更新
  renderer._setupViewportListener(id)
}

/** 为点要素构建经纬度 rbush 索引（缺失坐标跳过）；供视口裁剪候选查询复用 */
function buildPointSpatialIndex(features: PointFeature[]) {
  const index = createSpatialIndex<{ item: PointFeature; index: number }>()
  const items: IndexedItem<{ item: PointFeature; index: number }>[] = []
  features.forEach((item, index) => {
    const point = normalizePoint(item)
    if (!point) return
    items.push({
      minX: point.lng,
      minY: point.lat,
      maxX: point.lng,
      maxY: point.lat,
      data: { item, index },
    })
  })
  index.load(items)
  return index
}

/** 构建 Cesium 点 Entity（含 label/properties），点图层与视口裁剪复用（构建逻辑单一来源） */
export function createCesiumPointEntity(
  renderer: CesiumRenderer,
  id: string,
  item: PointFeature,
  index: number,
  options: LayerOptions
): Entity | null {
  // 坐标归一化走 normalizePoint（含 longitude 别名）；缺失坐标返回 null 由调用方跳过
  const point = normalizePoint(item)
  if (!point) return null
  const { lng, lat } = point
  return renderer.viewer!.entities.add({
    // id 追加 index：同名要素 id 会碰撞，重复 id 会覆盖旧实体 → 要素丢失 + 视口裁剪增删错乱
    id: `${id}-${item.id || item.name || 'p'}-${index}`,
    position: Cartesian3.fromDegrees(lng, lat),
    point: {
      pixelSize: options.size || 12,
      color: Color.fromCssColorString(options.color || LAYER_DEFAULTS.color),
      outlineColor: Color.WHITE,
      outlineWidth: 2,
      // CLAMP_TO_GROUND 贴地形：真地形就绪后点应落实际地表（椭球绝对高在北部湾 geoid 分离 -30~-70m 处会错位）
      heightReference: HeightReference.CLAMP_TO_GROUND,
    },
    label: options.labelField
      ? {
          text: String(item[options.labelField as keyof PointFeature]),
          font: '12px sans-serif',
          fillColor: Color.BLACK,
          showBackground: true,
          backgroundColor: Color.WHITE.withAlpha(0.8),
          verticalOrigin: 1,
          pixelOffset: new Cartesian2(0, 15),
        }
      : undefined,
    properties: { ...item, featureType: options.featureType || 'point' },
  })
}

/** 添加多边形图层（Polygon / MultiPolygon） */
export function addPolygonLayer(
  renderer: CesiumRenderer,
  id: string,
  features: PolygonFeature[],
  options: LayerOptions = {}
): void {
  // 幂等：先清除同 id 旧图层，防止 Entity 累积
  const existing = renderer._layers.get(id)
  if (existing) renderer._doRemoveLayer(existing)

  const entities: Entity[] = []

  features.forEach((item: PolygonFeature) => {
    const coordinates = item.coordinates || item.geometry?.coordinates
    if (!coordinates) return

    if (!Array.isArray(coordinates) || coordinates.length === 0) return

    const geometryType = item.geometry?.type
    const createPolygon = (polyCoords: unknown) => {
      try {
        if (!Array.isArray(polyCoords) || !Array.isArray(polyCoords[0])) return
        const outerRing = polyCoords[0].map(([lng, lat]: [number, number]) =>
          Cartesian3.fromDegrees(lng, lat)
        )
        const holes = polyCoords.slice(1).map((holeCoords: [number, number][]) => {
          const holePoints = holeCoords.map(([lng, lat]) => Cartesian3.fromDegrees(lng, lat))
          return new PolygonHierarchy(holePoints)
        })
        const entity = renderer.viewer!.entities.add({
          polygon: {
            hierarchy: new PolygonHierarchy(outerRing, holes),
            material: Color.fromCssColorString(options.fillColor || LAYER_DEFAULTS.fill),
            outline: true,
            outlineColor: Color.fromCssColorString(options.strokeColor || LAYER_DEFAULTS.stroke),
            outlineWidth: options.strokeWidth || 2,
            // 贴地形渲染：多边形沿真实地形起伏裁剪（淹没区不被山体盖住/悬空），替代椭球绝对高
            heightReference: HeightReference.CLAMP_TO_GROUND,
            classificationType: ClassificationType.TERRAIN,
          },
          properties: { ...item, featureType: options.featureType || 'polygon' },
        })
        entities.push(entity)
      } catch (e) {
        if (import.meta.env.DEV) {
          logger.warn('创建多边形实体失败:', e)
        }
      }
    }
    if (geometryType === 'MultiPolygon') {
      coordinates.forEach((polyCoords: unknown) => createPolygon(polyCoords))
    } else {
      const coords = geometryType === 'Polygon' ? coordinates : coordinates[0]
      createPolygon(coords)
    }
  })
  renderer._layers.set(id, {
    instance: entities,
    visible: true,
    options,
  })
  renderer._applyPendingVisibility(id)
  renderer.viewer!.scene.requestRender()
}

/** GeoJSON dataSource 样式应用（贴地形 polygon / point 样式），add/update 共用单一来源 */
function applyGeoJsonDataSourceStyle(dataSource: GeoJsonDataSource, options: LayerOptions): void {
  // entity 为 Cesium 运行期对象：polygon/position 属性赋值类型过严（Property/PropertyBag），
  // 保持 any 鸭子访问（样式应用是 Cesium 特有的运行期形态）
  dataSource.entities.values.forEach((entity: any) => {
    // properties 可能为 undefined（无属性的 GeoJSON 要素），判空避免崩溃
    if (!entity.properties) entity.properties = {}
    entity.properties.featureType = options.featureType || 'geojson'
    if (entity.polygon) {
      // 贴地形渲染：替代固定椭球绝对高（真地形就绪后，北部湾 geoid 分离 -30~-70m 会造成垂直错位）
      entity.polygon.heightReference = HeightReference.CLAMP_TO_GROUND
      entity.polygon.classificationType = ClassificationType.TERRAIN
      entity.polygon.material = Color.fromCssColorString(options.fillColor || LAYER_DEFAULTS.fill)
      entity.polygon.outline = true
      entity.polygon.outlineColor = Color.fromCssColorString(
        options.strokeColor || LAYER_DEFAULTS.stroke
      )
      entity.polygon.outlineWidth = options.strokeWidth || 2
    } else if (entity.position) {
      // 点要素用 PointGraphics 替代默认图钉，支持 markerColor/markerSize
      const markerColor = Color.fromCssColorString(options.markerColor || LAYER_DEFAULTS.marker)
      entity.billboard = undefined
      entity.point = new PointGraphics({
        pixelSize: options.markerSize || 10,
        color: markerColor,
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        // GeoJSON 点要素同样贴地形（同 createCesiumPointEntity）
        heightReference: HeightReference.CLAMP_TO_GROUND,
      })
    }
  })
}

/** 异步加载 GeoJSON 图层（Symbol token 竞态保护：await 后校验仍为最新请求） */
export async function addGeoJsonLayer(
  renderer: CesiumRenderer,
  id: string,
  geojson: FeatureCollection,
  options: LayerOptions = {}
): Promise<void> {
  // 幂等：先清除同 id 旧图层，防止 dataSource 累积
  const existing = renderer._layers.get(id)
  if (existing) renderer._doRemoveLayer(existing)

  // 异步竞态保护：token 标记当前请求，await 后检查是否仍为最新
  renderer._geoJsonTokens = renderer._geoJsonTokens || new Map()
  const token = Symbol(id)
  renderer._geoJsonTokens.set(id, token)

  try {
    // 防御：viewer 可能已被 30s 空闲销毁（渲染器对象存活但 viewer 已失效），提前检出走 onError
    // 让 BLM 感知重试；isDestroyed 须严格 === true（mock 的 chainable 函数返回 truthy 会误判）
    const viewerDestroyed =
      !renderer.viewer ||
      (typeof renderer.viewer!.isDestroyed === 'function' &&
        renderer.viewer!.isDestroyed() === true)
    if (viewerDestroyed) {
      renderer._geoJsonTokens.delete(id)
      ;(options.onError as ((msg: string) => void) | undefined)?.('Viewer 已销毁，图层创建失败')
      return
    }

    const dataSource = await GeoJsonDataSource.load(geojson)

    // await 后检查：若有更新的同 id 请求，丢弃本次结果
    if (renderer._geoJsonTokens.get(id) !== token) return

    logger.debug(`[CesiumRenderer] GeoJSON ${id} entities:`, dataSource.entities.values.length)
    applyGeoJsonDataSourceStyle(dataSource, options)
    renderer.viewer!.dataSources.add(dataSource)

    // 再次检查 token，防止 await 期间被新请求覆盖
    if (renderer._geoJsonTokens.get(id) !== token) {
      renderer.viewer!.dataSources.remove(dataSource, true)
      return
    }

    renderer._layers.set(id, {
      instance: dataSource,
      visible: true,
      options,
    })
    renderer._applyPendingVisibility(id)
    renderer.viewer!.scene.requestRender()
    // 成功路径清理 token，避免 Map 跨 id 累积增长
    renderer._geoJsonTokens.delete(id)
  } catch (error: unknown) {
    // 陈旧请求（已被更新的同 id 请求覆盖）失败不触发 onError，避免误报
    if (renderer._geoJsonTokens.get(id) !== token) return
    renderer._geoJsonTokens.delete(id)
    if (import.meta.env.DEV) {
      logger.error(`GeoJSON图层 ${id} 加载失败`, error)
    }
    ;(options.onError as ((msg: string) => void) | undefined)?.('GeoJSON数据加载失败')
  }
}

/**
 * 增量更新 GeoJSON 图层：复用已有 dataSource 调 load 替换数据，
 * 避免 remove+add 全量重建的闪烁与 dataSource 对象销毁开销；异步竞态沿用 token 保护。
 */
export async function updateGeoJsonLayer(
  renderer: CesiumRenderer,
  id: string,
  geojson: FeatureCollection,
  options: LayerOptions = {}
): Promise<void> {
  const entry = renderer._layers.get(id)
  if (!entry) return
  // instance 为 unknown：先提取并窄化（typeof 守卫，防 null/非 dataSource）
  const dataSource = entry.instance as GeoJsonDataSource | undefined
  if (!dataSource || typeof dataSource.load !== 'function') {
    // 无实例/非 dataSource（异常态）：回退重建
    await addGeoJsonLayer(renderer, id, geojson, options)
    return
  }

  // 与 add 同款 token 竞态保护
  renderer._geoJsonTokens = renderer._geoJsonTokens || new Map()
  const token = Symbol(id)
  renderer._geoJsonTokens.set(id, token)

  try {
    // dataSource 已在上方窄化（typeof load === 'function'）
    // 样式选项先更新（load 重建 entities 后样式需重放）
    entry.options = { ...entry.options, ...options }
    await dataSource.load(geojson)

    if (renderer._geoJsonTokens.get(id) !== token) return
    applyGeoJsonDataSourceStyle(dataSource, entry.options)
    renderer._applyPendingVisibility(id)
    renderer.viewer!.scene.requestRender()
    renderer._geoJsonTokens.delete(id)
  } catch (error: unknown) {
    if (renderer._geoJsonTokens.get(id) !== token) return
    renderer._geoJsonTokens.delete(id)
    if (import.meta.env.DEV) {
      logger.error(`GeoJSON图层 ${id} 增量更新失败`, error)
    }
    ;(options.onError as ((msg: string) => void) | undefined)?.('GeoJSON数据更新失败')
  }
}

/**
 * 添加 GeoTIFF 栅格图层（3D 回退方案）：Cesium 影像不支持 GeoTIFF 解码，将 .tif 映射为
 * 预生成 hillshade PNG（EPSG:4326 地理坐标）贴椭球面——山体明暗观感，无真 z 起伏（伪三维）。
 * 与 2D 共用同一份 BusinessLayerManager 注册；2D↔3D 切换时由 App.vue 的 reapplyAll 重绘。
 */
export function addGeoTIFFLayer(
  renderer: CesiumRenderer,
  id: string,
  url: string,
  options: LayerOptions = {}
): boolean {
  // 入口日志：无论走哪个分支都打印，便于排查"图层没挂载"（调用了/跳过了/URL 是什么）
  logger.debug(
    `[CesiumRenderer] addGeoTIFFLayer 调用: id=${id} url=${url} terrainReady=${renderer._terrainReady}`
  )

  // 回退方案仅支持预生成的 hillshade 影像；其它 GeoTIFF 在 3D 下暂不支持
  if (!/hillshade/i.test(url)) {
    logger.debug(`[CesiumRenderer] addGeoTIFFLayer 仅支持 hillshade 回退，跳过: ${url}`)
    return false
  }

  // DEM（数字高程模型）是独立图层，显隐由图层面板控制；真地形（terrainProvider z 起伏）
  // 是常驻基础能力，不与 DEM 图层开关耦合（曾据此跳过导致面板开关空转）
  // 整体防御：渲染失败仅记录完整错误，不向调用方（reapplyAll）抛错，避免单图层问题中断整批引擎切换重绘
  try {
    // 幂等：先清除同 id 旧图层
    const existing = renderer._layers.get(id)
    if (existing) renderer._doRemoveLayer(existing)

    // Cesium 影像不支持 GeoTIFF，映射为预生成的 PNG 影像（两者地理范围一致）
    const pngUrl = url.replace(/\.tif$/i, '.png')

    // hillshade PNG 为 EPSG:4326 地理坐标，须显式 GeographicTilingScheme（默认 WebMercator 3857
    // 会把北部湾 21°N 的纬度投影到错误位置，3D 下贴图不可见）；新版还强制校验
    // tileWidth/tileHeight（缺省抛 DeveloperError），须传 PNG 实际像素 4096×2819
    const provider = new SingleTileImageryProvider({
      url: pngUrl,
      rectangle: Rectangle.fromDegrees(106.9720001, 20.9379894, 110.0783727, 23.0760978),
      tilingScheme: new GeographicTilingScheme(),
      tileWidth: 4096,
      tileHeight: 2819,
    } as any)
    // 补 PNG 加载失败监听（OL 侧 addGeoTIFFLayer 已有等价监听）：把静默无图变成可见 warn
    // F-5：具名回调；provider 生命周期与图层绑定（hillshade 移除即销毁），无独立泄漏路径
    if (provider.errorEvent) {
      const hillshadeErrorHandler = (err: unknown) => {
        logger.warn(`[CesiumRenderer] hillshade 影像加载失败: ${pngUrl}`, err)
      }
      provider.errorEvent.addEventListener(hillshadeErrorHandler)
    }
    const imageryLayer = renderer.viewer!.imageryLayers.addImageryProvider(provider)
    // hillshade 顶层叠加 + 默认 alpha 0.85：明暗清晰可辨（曾 0.45 太淡，用户视觉上看不到 DEM 图层；
    // 天地图影像在下层透出轮廓，注记层最上显示地名）；真 3D 已由地形瓦片承接，此为降级兜底
    imageryLayer.alpha = options.opacity ?? 0.85
    // 记录 hillshade 引用供移除/可见性操作
    renderer._hillshadeLayer = imageryLayer
    // 不得 lowerToBottom：hillshade 须在天地图之上（alpha 半透明叠加），沉底会被盖住致 DEM 图层不可见

    renderer._layers.set(id, {
      instance: imageryLayer,
      visible: true,
      options,
    })
    renderer._applyPendingVisibility(id)
    renderer.viewer!.scene.requestRender()
    logger.debug(`[CesiumRenderer] addGeoTIFFLayer 已添加 hillshade 回退贴图: ${id} → ${pngUrl}`)
    return true
  } catch (error: unknown) {
    // 完整错误信息（name/message）用于定位投影或 imageryLayers 层问题
    logger.error(
      `[CesiumRenderer] addGeoTIFFLayer 失败 ${id} → ${url}: ${(error as Error)?.name}: ${(error as Error)?.message}`,
      error
    )
    return false
  }
}

/** 设置图层可见性：Entity 数组逐个 show；dataSource / imageryLayer 直接设 show */
export function doSetVisibility(renderer: CesiumRenderer, id: string, visible: boolean): void {
  const layer = renderer._layers.get(id)
  const inst = layer?.instance
  if (inst) {
    if (Array.isArray(inst)) {
      inst.forEach((entity: unknown) => {
        if (entity && typeof entity === 'object') {
          ;(entity as { show?: boolean }).show = visible
        }
      })
    } else if (typeof inst === 'object') {
      ;(inst as { show?: boolean }).show = visible
    }
    renderer.viewer!.scene.requestRender()
  }
}

/** 移除图层实例：先摘除视口裁剪监听（点图层特有），再按类型移除并释放资源 */
export function doRemoveLayer(renderer: CesiumRenderer, layer: LayerState): void {
  // 移除视口监听（视口裁剪点图层特有，其它图层为 undefined）；rAF 挂起也一并取消
  if (layer.cameraListener) {
    renderer.viewer!.camera.changed.removeEventListener(layer.cameraListener)
    layer.cameraListener = null
  }
  if (layer._viewportRafId) {
    cancelAnimationFrame(layer._viewportRafId)
    layer._viewportRafId = null
  }
  if (layer.instance) {
    if (Array.isArray(layer.instance)) {
      layer.instance.forEach((entity: unknown) => {
        if (entity && typeof entity === 'object') {
          renderer.viewer!.entities.remove(entity as Entity)
        }
      })
    } else {
      // instance 为 unknown：按 Cesium 容器逐一尝试（imageryLayers / dataSources）
      const inst = layer.instance as unknown as ImageryLayer | DataSource | undefined
      if (inst && renderer.viewer!.imageryLayers.contains(inst as ImageryLayer)) {
        // 影像图层（如 hillshade 回退贴图），destroy=true 释放 GPU 纹理
        renderer.viewer!.imageryLayers.remove(inst as ImageryLayer, true)
      } else if (inst) {
        // 第二参数 destroy=true 让 Cesium 在移除时销毁 dataSource，防止内存泄漏
        renderer.viewer!.dataSources.remove(inst as DataSource, true)
      }
    }
    renderer.viewer!.scene.requestRender()
  }
}

// ===== 视口裁剪：视口范围估算与点要素增量更新 =====
/**
 * 视口裁剪：估算视口经纬度范围、点要素裁剪、相机移动时增量更新。
 * 状态存于图层条目的 allFeatures（原始全量要素）与 cameraListener（相机监听，rAF 防抖）。
 */

/** 视口经纬度范围 */
export interface ViewportBBox {
  west: number
  east: number
  south: number
  north: number
}

/**
 * 计算相机视口经纬度范围。
 * 注意：positionCartographic 的经纬度为弧度，须 toDegrees 后与要素经纬度比较。
 * 优先 computeViewRectangle 取真实视口四角投影（倾斜视角下边缘要素不再被圆形估算误裁），
 * 不可用时回退相机高度圆形估算；太高（>5000km）或无相机返回 null（不裁剪）。
 */
export function getViewportBBox(renderer: CesiumRenderer): ViewportBBox | null {
  if (!renderer.viewer!) return null
  const camera = renderer.viewer!.camera
  const scene = renderer.viewer!.scene
  const cartographic = camera.positionCartographic
  if (!cartographic) return null
  const height = cartographic.height
  if (height > 5000000) return null // 太高不做裁剪

  // 真实视口四角投影：倾斜视角下边缘要素不再被误裁
  try {
    const rect = camera.computeViewRectangle(scene?.globe.ellipsoid)
    if (rect) {
      return {
        west: CesiumMath.toDegrees(rect.west),
        east: CesiumMath.toDegrees(rect.east),
        south: CesiumMath.toDegrees(rect.south),
        north: CesiumMath.toDegrees(rect.north),
      }
    }
  } catch {
    // computeViewRectangle 在场景未渲染等场景可能抛错——回退下方估算
  }

  // 兜底：相机高度圆形估算（仅真实投影不可用时的近似）
  const halfRange = Math.min((height / 111000) * 1.5, 10) // 上限 10 度
  const centerLon = CesiumMath.toDegrees(cartographic.longitude)
  const centerLat = CesiumMath.toDegrees(cartographic.latitude)
  return {
    west: centerLon - halfRange,
    east: centerLon + halfRange,
    south: centerLat - halfRange,
    north: centerLat + halfRange,
  }
}

/** 点是否在视口内（bbox 为 null 时不裁剪，返回 true） */
export function isInViewport(lng: number, lat: number, bbox: ViewportBBox | null): boolean {
  if (!bbox) return true // 无视口信息时不裁剪
  return lng >= bbox.west && lng <= bbox.east && lat >= bbox.south && lat <= bbox.north
}

/** 注册视口变化监听：相机移动时 requestAnimationFrame 防抖合并，增量更新裁剪图层 */
export function setupViewportListener(renderer: CesiumRenderer, id: string): void {
  const layer = renderer._layers.get(id)
  if (!layer || !layer.allFeatures) return

  // 防抖：相机移动时频繁触发，用 requestAnimationFrame 合并；rafId 存图层条目，
  // 图层移除时随 cameraListener 一并 cancel（闭包持有无法取消）
  const updateHandler = () => {
    if (layer._viewportRafId) cancelAnimationFrame(layer._viewportRafId)
    layer._viewportRafId = requestAnimationFrame(() => {
      updateCulledLayer(renderer, id)
      layer._viewportRafId = null
    })
  }

  // 移除旧监听（如果存在）
  if (layer.cameraListener) {
    renderer.viewer!.camera.changed.removeEventListener(layer.cameraListener)
  }

  renderer.viewer!.camera.changed.addEventListener(updateHandler)
  layer.cameraListener = updateHandler
}

/** 增量更新裁剪图层：移除出视口的 Entity，添加新进入的（Entity ID 与 _createCesiumPointEntity 一致） */
export function updateCulledLayer(renderer: CesiumRenderer, id: string): void {
  const layer = renderer._layers.get(id)
  if (!layer || !layer.allFeatures || !layer.visible) return

  const bbox = getViewportBBox(renderer)
  if (!bbox) return

  // 候选集：优先 rbush 索引查询（W4-17，相机移动 O(logN)），无索引回退全量遍历
  const spatialIndex = layer._spatialIndex as { query: (bbox: number[]) => unknown[] } | undefined
  const candidates: Array<{ item: PointFeature; index: number }> = spatialIndex
    ? (
        spatialIndex.query([bbox.west, bbox.south, bbox.east, bbox.north]) as Array<
          IndexedItem<{ item: PointFeature; index: number }>
        >
      ).map((it) => it.data)
    : layer.allFeatures.map((item: PointFeature, index: number) => ({ item, index }))

  // 计算应显示的要素 ID 集合（ID 与 _createCesiumPointEntity 保持一致：id-name-index）
  const shouldShow = new Set<string>()
  candidates.forEach(({ item, index }: { item: PointFeature; index: number }) => {
    // 坐标归一化走 normalizePoint（含 longitude 别名）；缺失坐标跳过
    const point = normalizePoint(item)
    if (!point) return
    const { lng, lat } = point
    if (isInViewport(lng, lat, bbox)) {
      shouldShow.add(`${id}-${item.id || item.name || 'p'}-${index}`)
    }
  })

  // 移除不在视口内的 Entity（点图层 instance 为 Entity[]；非数组图层不进入本函数）
  const entities = layer.instance as Entity[]
  for (const entity of entities) {
    if (!shouldShow.has(entity.id)) {
      renderer.viewer!.entities.remove(entity)
    }
  }

  // 添加新进入视口的 Entity
  const existingIds = new Set<string>(entities.map((e: Entity) => e.id))
  candidates.forEach(({ item, index }: { item: PointFeature; index: number }) => {
    const entityId = `${id}-${item.id || item.name || 'p'}-${index}`
    if (shouldShow.has(entityId) && !existingIds.has(entityId)) {
      const entity = renderer._createCesiumPointEntity(id, item, index, layer.options ?? {})
      if (entity) entities.push(entity)
    }
  })

  // 清理已移除的 Entity 引用（entities 为局部窄化数组，写回 instance）
  layer.instance = entities.filter((e) => renderer.viewer!.entities.contains(e))
}

// ===== 水面：Primitive 增量更新 =====
/**
 * 水面：Primitive API 管理（适合大规模几何体），状态存于 renderer._waterSurfaces。
 * 水位更新复用同一 Primitive、仅替换 geometryInstances（重建会销毁旧几何并异步构建新几何，
 * 中间空窗致水位拖动"一闪一闪"）。
 */

/** 水面状态条目 */
interface WaterSurfaceEntry {
  primitive: Primitive
  height: number
  coordinates: [number, number][]
  options: WaterSurfaceOptions
  visible: boolean
  /** 地形基准（每顶点地形高度，椭球高制）：海面抬升语义 = 基准 + 水位；无真地形时全 0 */
  terrainBase: number[]
}

/**
 * 采样坐标点的地形高度（椭球高制）作为水面基准。
 * 真地形（海拔制）下椭球绝对高存在 geoid 分离（北部湾 -30~-70m），
 * 水面直接按水位取椭球高会沉入地下不可见——必须采样地形后叠加水位。
 * 无真地形（EllipsoidTerrainProvider）或采样失败时回退 0（旧行为）。
 */
async function sampleTerrainHeights(
  renderer: CesiumRenderer,
  coordinates: [number, number][]
): Promise<number[]> {
  try {
    const terrainProvider = renderer.viewer?.terrainProvider as
      | { availability?: unknown }
      | undefined
    if (!terrainProvider || !terrainProvider.availability) {
      return coordinates.map(() => 0)
    }
    const positions = coordinates.map(([lng, lat]) => Cartographic.fromDegrees(lng, lat))
    const sampled = await sampleTerrain(renderer.viewer!.terrainProvider, 10, positions)
    return sampled.map((s) => s.height ?? 0)
  } catch {
    // 采样失败不阻断水面创建，回退椭球基准（与旧行为一致）
    return coordinates.map(() => 0)
  }
}

/** 构建水面 GeometryInstance（create 与 update 复用，避免重复代码） */
function buildWaterInstance(
  coordinates: [number, number][],
  height: number,
  options: WaterSurfaceOptions,
  terrainBase: number[] = []
): GeometryInstance {
  const positions = coordinates.map((coord, i) =>
    Cartesian3.fromDegrees(coord[0], coord[1], (terrainBase[i] ?? 0) + height)
  )
  const hierarchy = new PolygonHierarchy(positions)
  const geometry = new PolygonGeometry({
    polygonHierarchy: hierarchy,
    vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
  })

  return new GeometryInstance({
    geometry: geometry,
    attributes: {
      color: ColorGeometryInstanceAttribute.fromColor(
        // 水面色复用 LAYER_DEFAULTS.color（#409eff），保留 0.5 透明度以维持水面半透明观感
        Color.fromCssColorString((options.color as string) || LAYER_DEFAULTS.color).withAlpha(0.5)
      ),
    },
    id: `water-${height}`,
  })
}

/** 添加水面 Primitive（先移除同 id 旧水面，幂等；真地形下采样基准叠加水位） */
export async function addWaterSurface(
  renderer: CesiumRenderer,
  id: string,
  coordinates: [number, number][],
  height = 0,
  options: WaterSurfaceOptions = {}
): Promise<boolean> {
  removeWaterSurface(renderer, id)
  try {
    const terrainBase = await sampleTerrainHeights(renderer, coordinates)
    const instance = buildWaterInstance(coordinates, height, options, terrainBase)

    const appearance = new PerInstanceColorAppearance({
      translucent: true,
      closed: false,
    })

    const primitive = new Primitive({
      geometryInstances: instance,
      appearance: appearance,
      asynchronous: false,
    })

    renderer.viewer!.scene.primitives.add(primitive)

    // 保存水面状态供后续更新使用
    renderer._waterSurfaces = renderer._waterSurfaces || new Map()
    renderer._waterSurfaces.set(id, {
      primitive: primitive,
      height: height,
      coordinates: coordinates,
      options: options,
      visible: true,
      terrainBase: terrainBase,
    })

    renderer.viewer!.scene.requestRender()
    return true
  } catch (e) {
    // 坐标无效或几何体构建失败时不中断调用方
    if (import.meta.env.DEV) {
      logger.warn(`[CesiumRenderer] 水面图层 ${id} 创建失败:`, e)
    }
    return false
  }
}

/**
 * 更新水位：复用同一 Primitive，仅同步替换 geometryInstances。
 * 不 remove+add → 无重建空窗（水位拖动不闪烁），并保留 GPU 缓冲复用路径。
 */
export function updateWaterLevel(renderer: CesiumRenderer, id: string, newHeight: number): boolean {
  const waterSurface: WaterSurfaceEntry | undefined = renderer._waterSurfaces?.get(id)
  if (!waterSurface) {
    if (import.meta.env.DEV) {
      logger.warn(`水面图层 ${id} 不存在，无法更新水位`)
    }
    return false
  }

  // 高度未变化 → 跳过（滑块拖动可能触发同值更新）
  if (waterSurface.height === newHeight) return true

  try {
    // 同步构建新几何替换到同一 Primitive：Cesium 类型将 geometryInstances 标为只读，
    // 但运行时支持替换（增量更新依赖此行为），用断言绕过类型只读标注
    ;(waterSurface.primitive as { geometryInstances: unknown }).geometryInstances =
      buildWaterInstance(
        waterSurface.coordinates,
        newHeight,
        waterSurface.options,
        waterSurface.terrainBase
      )
    waterSurface.height = newHeight
    renderer.viewer!.scene.requestRender()
    return true
  } catch (e) {
    // 构建失败保持旧水位（不闪、不崩），仅日志
    if (import.meta.env.DEV) {
      logger.warn(`[CesiumRenderer] 水面 ${id} 水位更新失败（保持旧水位）:`, e)
    }
    return false
  }
}

/** 移除水面 Primitive */
export function removeWaterSurface(renderer: CesiumRenderer, id: string): boolean {
  const waterSurface: WaterSurfaceEntry | undefined = renderer._waterSurfaces?.get(id)
  if (waterSurface) {
    renderer.viewer!.scene.primitives.remove(waterSurface.primitive)
    // _waterSurfaces 只可能在 viewer 销毁路径置 null；此处 waterSurface 非空即 Map 存在
    renderer._waterSurfaces!.delete(id)
    renderer.viewer!.scene.requestRender()
    return true
  }
  return false
}

/** 移除全部水面 */
export function removeAllWaterSurfaces(renderer: CesiumRenderer): boolean {
  if (renderer._waterSurfaces) {
    renderer._waterSurfaces.forEach((_: WaterSurfaceEntry, id: string) =>
      removeWaterSurface(renderer, id)
    )
    return true
  }
  return false
}

/** 设置水面可见性 */
export function setWaterSurfaceVisibility(
  renderer: CesiumRenderer,
  id: string,
  visible: boolean
): boolean {
  const waterSurface: WaterSurfaceEntry | undefined = renderer._waterSurfaces?.get(id)
  if (waterSurface) {
    waterSurface.visible = visible
    waterSurface.primitive.show = visible
    renderer.viewer!.scene.requestRender()
    return true
  }
  return false
}

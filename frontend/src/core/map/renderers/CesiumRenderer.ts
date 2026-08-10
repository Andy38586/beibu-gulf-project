// 2026-08-09：移除 @ts-nocheck（Cesium 渲染器类型补全，原 147 个 typecheck 错误渐进清零）
// P8：4 个假拆分文件（Events/LayerRegistrar/ViewportCulling/WaterSurface）合并回本文件，
// import 已合并去重（物理搬移，逻辑零改动）
// 拆分方向（2026-08-09，不引入 hook/composable——沿用模块级函数 + renderer 参数模式）：
// 模块级函数区（本文件 950 行起）按能力域拆为同目录纯函数模块：
//   cesium-water.ts（水面）→ cesium-terrain.ts（DEM/terrainProvider）→ cesium-camera.ts（相机/飞行）→
//   cesium-layers.ts（图层 helper）→ cesium-breathing.ts（呼吸动画）→ CesiumViewerManager.ts（viewer 生命周期）
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
  GeometryInstance,
  HeightReference,
  Math as CesiumMath,
  PerInstanceColorAppearance,
  PointGraphics,
  PolygonGeometry,
  PolygonHierarchy,
  Primitive,
  Rectangle,
  ScreenSpaceEventType,
  SingleTileImageryProvider,
  UrlTemplateImageryProvider,
  Viewer,
} from 'cesium'
import type { FeatureCollection } from 'geojson'

import { buildTiandituUrl, MAP_CONFIG, zoomToHeight } from '@/core/config/map'
import { LAYER_DEFAULTS } from '@/shared'
import { logger } from '@/shared'
import type {
  CameraState,
  FlyToOptions,
  FlyToTarget,
  LayerOptions,
  PointFeature,
  PolygonFeature,
  WaterSurfaceOptions,
} from '@/types'

import { MapRenderer } from './MapRenderer'

// CesiumViewer单例：全局唯一Viewer，按需mount/unmount复用，30s空闲自动销毁
class CesiumViewerManager {
  // 2026-08-09 类型补全：自有字段显式声明
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
      sceneModePicker: false,
      navigationHelpButton: false,
      timeline: false,
      animation: false,
      // 240Hz 渲染治理（2026-08-05，拖拽掉帧 50avg/20min 优化）：
      // - requestRenderMode: true —— 静止零渲染（省 GPU/CPU）。相机交互（拖拽/缩放/
      //   旋转）由 Cesium 内部自动 requestRender，不影响交互；图层/水面/相机防抖/动画
      //   等全部动态更新路径均已显式 requestRender（CesiumLayerRegistrar/CesiumWaterSurface
      //   /CesiumEvents/startBreathing 均有调用），无"画面不刷新"风险。
      // - highDynamicRange/fxaa/antialias 关闭 —— 240Hz 屏每帧预算仅 ~6ms（160fps），
      //   HDR 后处理 + FXAA + MSAA 是拖拽掉帧的主要 GPU 开销来源。
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
      // cesium 类型未收录 highDynamicRange/fxaa（版本差异），结构化断言保留运行期行为
    } as unknown as ConstructorParameters<typeof Viewer>[1])

    // LOD 粗一级（默认 2 → 4）：globe 网格面数约减半，拖拽更流畅；
    // 真地形瓦片接入后配合瓦片 LOD 效果更明显（视觉可接受，远处地形略简）。
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

    // 如果 viewerContainer 就是 el 本身，说明已经在正确位置
    if (viewerContainer === el) {
      this.isMounted = true
      this.viewer.resize()
      // 2026-08-06 a047: 保持 requestRenderMode=true（按需渲染）——create() 已论证
      // 所有动态路径（图层/水面/相机防抖/动画）均显式 requestRender，无"不刷新"风险；
      // 此处曾无条件置 false（持续渲染），240Hz 屏静止时 GPU 全速空转 → 掉帧至 17fps。
      // requestRender() 触发当前帧刷新，相机交互由 Cesium 内部自动 requestRender。
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
    // a047: 同上方——保持按需渲染，仅刷新当前帧（unmount 已置 true，无需改）
    this.viewer.scene.requestRender()
    // 确保相机控制器的交互能力正常（拖拽、旋转、缩放等）
    this._enableCameraControls()

    return true
  }

  /**
   * 启用相机控制器的所有交互能力
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

    this.isMounted = false
    // 暂停渲染，降低GPU占用（容器由 Vue v-show 隐藏为 display:none，此处停止渲染循环即可）
    this.viewer.scene.requestRenderMode = true
    // 启动空闲销毁定时器（30秒后自动销毁释放内存）
    this._startIdleDestroyTimer()
  }

  /**
   * 启动空闲销毁定时器
   * 30秒后自动销毁Viewer实例，释放内存
   */
  _startIdleDestroyTimer() {
    this._clearIdleDestroyTimer()
    this._idleDestroyTimer = setTimeout(() => {
      logger.debug('[CesiumViewerManager] 30秒空闲，自动销毁Viewer释放内存')
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
   * 设置底图引用（供复用时新 CesiumRenderer 实例获取）
   * 公开方法，替代直写私有属性 _baseLayers
   * @param {{ image: unknown[], vector: unknown[] }} layers
   */
  setBaseLayers(layers: { image: unknown[]; vector: unknown[] }): void {
    this._baseLayers = layers
  }

  /**
   * 获取底图引用
   * @returns {{ image: unknown[], vector: unknown[] } | null}
   */
  getBaseLayers() {
    return this._baseLayers || null
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

  /**
   * 显式真正销毁接口（应用退出 / HMR / 测试场景）。
   * 等价于 destroy()，保留命名以匹配审计要求；常规卸载仍走 unmount() 保留复用。
   */
  destroyViewer() {
    this._clearIdleDestroyTimer()
    this.destroy()
  }
}

// 全局单例管理器
export const cesiumViewerManager = new CesiumViewerManager()

/**
 * CesiumRenderer - Cesium三维渲染器
 * 基于单例缓存+按需挂载策略：
 * - 首次进入3D路由时创建Viewer
 * - 离开3D路由时unmount（不销毁）
 * - 再次进入时mount复用，状态保留
 */
/**
 * Cesium 3D 渲染器。
 * 类型契约：本类字段类型随 @ts-nocheck 保留为运行期 JSDoc 参考（renderers.d.ts 已删，见 P1）。
 */
export class CesiumRenderer extends MapRenderer {
  // 2026-08-09 类型补全：自有字段显式声明（原 @ts-nocheck 隐藏，运行期行为不变）
  viewer: Viewer | null
  baseLayers: { image: unknown[]; vector: unknown[] }
  _isReusing: boolean
  _cameraDebounceTimer: ReturnType<typeof setTimeout> | null
  _terrainReady: boolean
  _terrainProvider: CesiumTerrainProvider | null
  _terrainEnabled: boolean
  _hillshadeLayer: unknown
  _imageryErrorLogged: boolean
  _screenSpaceEventHandler: {
    setInputAction: (fn: (input: unknown) => void, type?: unknown) => void
  } | null
  _cameraChangedHandler: (() => void) | null
  _waterSurfaces: Map<string, WaterSurfaceEntry> | null
  _breathingEntity: unknown | null
  _breathingAnimId: number | null
  _breathingAnimation: unknown | null
  _geoJsonTokens: Map<symbol, symbol>

  constructor(container: HTMLElement) {
    super(container)
    this.viewer = null
    this.baseLayers = { image: [], vector: [] }
    this._isReusing = false // 标记是否复用已有Viewer
    this._cameraDebounceTimer = null // 相机变化防抖定时器
    /** 真地形就绪标志：_setupTerrain 成功后置 true；业务层 addGeoTIFFLayer 据此
     *  跳过 hillshade 回退贴图（真地形 z 起伏 + Cesium 光照取代伪三维明暗图）。 */
    this._terrainReady = false
    /** 真地形 provider 引用（setTerrainEnabled 切换用）；未就绪为 null */
    this._terrainProvider = null
    /** "真实地形"开关状态（3D 语义）：默认开——_setupTerrain 自动加载真地形即显示 */
    this._terrainEnabled = true
    /** hillshade 回退贴图引用：真地形就绪后隐藏，避免盖住天地图底图 */
    this._hillshadeLayer = null
    /** 底图瓦片失败 warn 只打一次（防每个瓦片刷屏） */
    this._imageryErrorLogged = false
    // 2026-08-09 类型补全：以下字段在挂载/图层路径惰性初始化，constructor 显式置空/置初值
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
      // 真 3D 地形（瓦片加载，用户拍板 2026-08-06）：
      // CesiumTerrainProvider 按需 LOD 加载 heightmap-1.0 瓦片（backend/static/terrain/，
      // CTB 预切片 z0-12，Int16 输入 + 标准命令生成）。Cesium 按相机距离只拉需要的层级，
      // 不像全量 mesh 一次性算完 75 万顶点（用户实测卡爆），也不像内存切片每次请求
      // 重采样（之前方案）。成功置 _terrainReady → hillshade 回退退场；失败静默降级
      // 保持 hillshade 全量贴图（998920d 稳定基线）。
      void this._setupTerrain()
    } else {
      // 复用时从单例管理器获取底图引用（公开方法）
      this.baseLayers = cesiumViewerManager.getBaseLayers()
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
   * 监听相机移动事件，300ms防抖后才触发渲染和状态同步。
   * 避免拖拽/缩放过程中频繁更新，降低CPU/GPU负载。
   */
  _setupCameraDebounce() {
    // 委托至 CesiumEvents.ts（纯搬移，逻辑零变化）
    setupCameraDebounce(this)
  }

  _setupZoomLimits(): void {
    const viewer = this.viewer
    if (!viewer) return
    const controller = viewer.scene.screenSpaceCameraController
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

  /** 真地形接入：/static/terrain/ 目录 → CesiumTerrainProvider。失败静默降级（不阻塞 Viewer）。 */
  async _setupTerrain() {
    try {
      const viewer = this.viewer
      if (!viewer) return
      // CesiumTerrainProvider.fromUrl 把传入 URL 当 baseUrl（目录），fetch `${url}layer.json`
      // 取瓦片清单（实测：传文件 URL '.../layer.json' 会拼成 '.../layer.json/layer.json' 404，
      // 然后 fallback 内置默认 tiles='layer.json/{z}/{x}/{y}.terrain' v=1.0.0）。
      // 因此必须传**目录 URL**（尾斜杠）。瓦片路径由 layer.json 的 tiles 模板解析。
      const provider = await CesiumTerrainProvider.fromUrl('/static/terrain/', {
        // CTB 输出的 .terrain 是 gzip 压缩流（文件头 1f 8b），Cesium 自动识别解压，
        // 无需服务器 Content-Encoding；请求端 gzip 由 Resource 层处理
        requestVertexNormals: true,
      })
      // viewer 可能已被 30s 闲置销毁，销毁后属性清空访问即崩
      if (!viewer || !viewer.scene || viewer.isDestroyed()) return
      this._terrainProvider = provider
      this._terrainReady = true
      // 地形开关默认开（_terrainEnabled=true）；若用户关过"真实地形"开关，
      // 保持椭球面，等 setTerrainEnabled(true) 再启用（重建后状态延续）
      if (this._terrainEnabled !== false) {
        viewer.terrainProvider = provider
      }
      // 2026-08-08（方案 A）：不再自动隐藏 hillshade——DEM 是独立图层（有地理信息
      // 的影像），显隐由图层面板开关控制（_layers 实例.show）。原逻辑在真地形就绪后
      // 无条件隐藏 _hillshadeLayer，导致 DEM 开关在 3D 下"点开无图"（用户实测）。
      viewer.scene.requestRender()
      logger.debug('[CesiumRenderer] 真地形接入成功: /static/terrain/layer.json')
    } catch (e) {
      // 无瓦片产物或加载失败 → 保持椭球面 + hillshade 回退（现状行为）
      // 带上失败原因便于排查（常见：dev 未重启 vite / 后端未起 / 瓦片目录缺失）
      logger.warn('[CesiumRenderer] 真地形接入跳过:', e instanceof Error ? e.message : e)
    }
  }

  /**
   * "真实地形"开关的 3D 语义：控制真地形 provider 的启用/停用。
   * 3D 下 geotiff 图层无独立实例（真地形已由 terrainProvider 呈现，addGeoTIFFLayer
   * 在 _terrainReady 时跳过）——开关直接切换 viewer.terrainProvider：
   * 开 = heightmap z 起伏（CesiumTerrainProvider），关 = 平坦椭球面。
   * 由 layerAdapters.geotiff.setVisibility 在 3D 下调用（2D 走 renderer.setVisibility）。
   */
  setTerrainEnabled(enabled: boolean): void {
    this._terrainEnabled = enabled
    if (!this.viewer || !this.viewer.scene || this.viewer.isDestroyed()) return
    // 真地形未就绪时无 provider 可切（保持椭球面现状，等 _setupTerrain 成功再按开关启用）
    if (!this._terrainProvider) return
    this.viewer.terrainProvider = enabled ? this._terrainProvider : new EllipsoidTerrainProvider()
    this.viewer.scene.requestRender()
  }

  _positionCamera(): void {
    const viewer = this.viewer
    if (!viewer) return
    viewer.scene.globe.enableLighting = true
    // 不主动定位相机，保持 Cesium 默认的远距离视角（美国上空）
    // 后续 _setCameraState 的 flyTo 会从该位置飞向目标，产生"地球飞转"效果
    // 这是主动设计的加载动画，避免 OL→Cesium 切换时闪一下的突兀感
  }

  _initBaseLayers(): void {
    // 防止重复初始化底图
    if (cesiumViewerManager.isBaseLayersInitialized()) {
      return
    }
    const viewer = this.viewer
    if (!viewer) return

    // 底图瓦片加载失败可见性（排查用）：注意 ImageryLayerCollection 没有 errorEvent
    // （仅有 layerAdded/layerRemoved/layerMoved/layerShown/layerHidden），errorEvent
    // 在 ImageryProvider 上（与 addGeoTIFFLayer 的 hillshade 监听同模式）。挂 collection
    // 会抛 TypeError 导致 3D 初始化失败——已踩坑（2026-08-05 20:29）。首次失败 warn 一次。
    const attachImageryErrorLog = (provider: UrlTemplateImageryProvider) => {
      if (!provider?.errorEvent) return
      provider.errorEvent.addEventListener((err: unknown) => {
        if (this._imageryErrorLogged) return
        this._imageryErrorLogged = true
        logger.warn(
          '[CesiumRenderer] 底图瓦片加载失败（首次）:',
          err instanceof Error ? err.message : err
        )
      })
    }

    // 关键：Cesium 的 UrlTemplateImageryProvider 只认内置占位符（x/y/z/s/…），
    // buildTiandituUrl 模板里的 {layerCode}/{key} 会被原样留在 URL 里发出去
    // （buildImageResource 对未知 tag 直接跳过）→ 天地图收到 {layerCode} 字面量
    // → 请求失败底图空白。OL 自实现模板替换所以正常。这里预替换为字面值。
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

    // 关键修复：将底图引用存储到单例管理器，供复用时新Renderer实例获取（公开方法）
    cesiumViewerManager.setBaseLayers({
      image: this.baseLayers.image,
      vector: this.baseLayers.vector,
    })

    cesiumViewerManager.markBaseLayersInitialized()
  }

  _setupClickHandler() {
    // 委托至 CesiumEvents.ts（纯搬移，逻辑零变化）
    setupClickHandler(this)
  }

  addPointLayer(id: string, features: PointFeature[], options: LayerOptions = {}): void {
    // 委托至模块级函数（2026-08-09 类型补全，逻辑零变化）
    addPointLayer(this, id, features, options)
  }

  /**
   * 创建并添加一个 Cesium 点 Entity（含 label / properties）
   * 供 addPointLayer 与 _updateCulledLayer 复用，保证实体构建逻辑单一来源。
   * @returns {object|null}
   */
  _createCesiumPointEntity(
    id: string,
    item: PointFeature,
    index: number,
    options: LayerOptions
  ): unknown {
    return createCesiumPointEntity(this, id, item, index, options)
  }

  /**
   * 计算当前相机视口的经纬度范围（简化估算）
   * ⚠️ 注意：Cesium `camera.positionCartographic` 的 longitude/latitude 单位为**弧度**，
   * 必须用 CesiumMath.toDegrees 转换为角度后再与要素经纬度比较。
   * @returns {{west:number, east:number, south:number, north:number} | null}
   */
  _getViewportBBox(): ViewportBBox | null {
    return getViewportBBox(this)
  }

  /**
   * 判断点是否在当前视口内
   */
  _isInViewport(lng: number, lat: number, bbox: ViewportBBox | null): boolean {
    return isInViewport(lng, lat, bbox)
  }

  /**
   * 为点图层注册视口变化监听
   * 相机移动时，增量添加/移除视口内外的要素（requestAnimationFrame 防抖）
   */
  _setupViewportListener(id: string): void {
    setupViewportListener(this, id)
  }

  /**
   * 视口变化时增量更新裁剪图层：移除离开视口的 Entity，添加新进入视口的 Entity
   */
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

  /**
   * 添加 GeoTIFF 栅格图层（3D 回退方案）
   * quantized-mesh 真地形门禁失败（沙箱无 ctb / pip，无法生成地形瓦片），
   * 降级为山体阴影贴图：用预生成的 dem_hillshade.png 作为 SingleTileImageryProvider
   * 贴在椭球面上。视觉有地形明暗感，但无真 z 值起伏（伪三维，非数字孪生级）。
   * 与 2D 共用同一份 BusinessLayerManager 注册（layerType:'geotiff', data:'...tif'），
   * 此处将 .tif 映射为 .png（Cesium 影像不支持 GeoTIFF 解码，需预生成 PNG 影像）。
   * 地理范围取自 dem_hillshade 的 gdalinfo 实测值（EPSG:4326，与 2D COG 完全一致）。
   * 2D↔3D 切换时由 App.vue 的 reapplyAll 重绘到新 renderer，无需额外接线。
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
      // Cesium duration 单位为秒（原 1000 秒 ≈ 16.6 分钟）
      // 2026-08-09（P1-4）：读 FlyToOptions.duration（秒）?? 默认 1
      duration: options.duration ?? 1,
      orientation: {
        heading: CesiumMath.toRadians(options.heading || 0),
        // 默认俯视 -90°（与 OL 2D 平坦视图一致），避免引擎切换时 pickEllipsoid 因倾斜产生偏移
        pitch: CesiumMath.toRadians(options.pitch ?? -90),
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

    // 两种方式获取中心点：
    // 1. positionCartographic: 相机正下方地面点（不受 tilt 影响）
    // 2. pickEllipsoid: 屏幕中心射线地面点（用户实际注视点，受 tilt 影响）
    // 优先用 pickEllipsoid（OL 无 tilt 概念，取其"用户想看的点"），
    // 失败时回退到 positionCartographic
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
    // 限制height范围：最低200m（避免贴地），最高2000000m（避免视角太高）。
    // 2026-08-06 上限 1000000→2000000：用户要求 Cesium 相机高度调高一倍
    // （VIEW_LEVELS.REGION 800km→1600km），原上限 1000km 会把 1600km 钳到 1000km，
    // "调高一倍"实际只生效 1.25 倍。1600km 约 0.25 地球半径，Cesium 视角安全。
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

    // 从 Cesium 默认远距离视角（美国上空）飞向北部湾，产生"地球飞转"效果
    // duration 3s 保证足够时间完成跨半球飞行，又不至于太慢
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
    // 预解析呼吸灯基准色（源自 LAYER_DEFAULTS.color = '#409eff'，即 rgb(64,158,255)）
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

  // 水面方法委托至模块级函数（纯搬移，逻辑零变化）
  addWaterSurface(
    id: string,
    coordinates: [number, number][],
    height = 0,
    options: WaterSurfaceOptions = {}
  ): boolean {
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
   * 覆写基类 hasLayer：水面存于 _waterSurfaces（不在 _layers），基类查不到。
   * BLM.updateData 用 hasLayer 判"图层缺失补 create vs 已存在走 update"——
   * 不覆写时水面每次水位变化都被判缺失 → 走 create → addWaterSurface
   * remove+add 全量重建 Primitive，增量更新（updateWaterLevel 替换
   * geometryInstances）永远走不到（06908b5 写的增量是死代码）。
   */
  hasLayer(id: string): boolean {
    return super.hasLayer(id) || (this._waterSurfaces?.has(id) ?? false)
  }

  /**
   * 覆写基类 isLayerVisible：水面存于 _waterSurfaces（含 visible 字段），
   * 基类 _layers 查不到——图层面板按钮状态对水面也读实例真实可见性。
   */
  isLayerVisible(id: string): boolean {
    if (super.isLayerVisible(id)) return true
    const ws = this._waterSurfaces?.get(id)
    return ws ? ws.visible : false
  }

  getType() {
    // P0-1: 返回 '3d'（与 MapType 一致）,理由同 OLRenderer
    return '3d'
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
    // 事件监听清理委托至 CesiumEvents.ts（相机监听 + 屏幕事件处理器）
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

  /**
   * 显式真正销毁 Viewer（仅测试 / HMR / 应用退出场景使用；
   * 常规卸载走 destroy() 保留复用语义）。
   */
  destroyViewer() {
    cesiumViewerManager.destroyViewer()
    this.viewer = null
  }
}

// ===== 合并自 CesiumEvents.ts（P8 物理搬移，逻辑零改动）=====
/**
 * CesiumEvents — Cesium 3D 事件监听管理
 * 拆分：从 CesiumRenderer.ts 纯搬移，逻辑零变化。
 * 负责 click / pointer-move / camera-changed 事件的注册与清理。
 * 事件状态存储在 renderer 实例上：
 * - renderer._screenSpaceEventHandler：屏幕事件处理器（click / mouse-move）
 * - renderer._cameraChangedHandler：相机变化监听器（防抖后 emit camera-changed）
 * - renderer._cameraDebounceTimer：相机变化防抖定时器
 */

/**
 * Cartesian3 转经纬度数组
 * @param cartesian Cesium.Cartesian3
 * @returns [lng, lat]（角度制）
 */
export function cartesianToLonLatArray(cartesian: any): [number, number] {
  const cartographic = Cartographic.fromCartesian(cartesian)
  return [CesiumMath.toDegrees(cartographic.longitude), CesiumMath.toDegrees(cartographic.latitude)]
}

/**
 * P1性能优化：相机变化防抖
 * 监听相机移动事件，300ms防抖后才触发渲染和状态同步。
 * 避免拖拽/缩放过程中频繁更新，降低CPU/GPU负载。
 * @param renderer CesiumRenderer 实例（访问 viewer / emit / _getCameraState）
 */
export function setupCameraDebounce(renderer: any): void {
  const DEBOUNCE_DELAY = 300
  // 保存监听器引用，供 destroy 移除，防止泄漏与 TypeError
  renderer._cameraChangedHandler = () => {
    // 清除之前的防抖定时器
    if (renderer._cameraDebounceTimer) {
      clearTimeout(renderer._cameraDebounceTimer)
    }
    renderer._cameraDebounceTimer = setTimeout(() => {
      // viewer 可能已置空，防御
      if (renderer.viewer) {
        renderer.viewer.scene.requestRender()
        // 相机变化防抖后回传状态（复用 _cameraChangedHandler，勿新增监听）
        renderer.emit('camera-changed', renderer._getCameraState())
      }
      renderer._cameraDebounceTimer = null
    }, DEBOUNCE_DELAY)
  }
  renderer.viewer.camera.changed.addEventListener(renderer._cameraChangedHandler)
}

/**
 * 设置点击与鼠标移动事件监听
 * - LEFT_CLICK：拾取要素 properties 并 emit click（含 featureType / data / coordinate）
 * - MOUSE_MOVE：a026 补齐 pointer-move 事件（emit 鼠标地面经纬度）
 * @param renderer CesiumRenderer 实例（访问 viewer / emit）
 */
export function setupClickHandler(renderer: any): void {
  renderer._screenSpaceEventHandler = renderer.viewer.screenSpaceEventHandler
  renderer._screenSpaceEventHandler.setInputAction((click: any) => {
    const pickedObject = renderer.viewer.scene.pick(click.position)
    const cartesian = renderer.viewer.camera.pickEllipsoid(click.position)
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

  // pointer-move 事件（补齐 MapRendererEventMap 声明）
  renderer._screenSpaceEventHandler.setInputAction((movement: any) => {
    const cartesian = renderer.viewer.camera.pickEllipsoid(
      movement.endPosition,
      renderer.viewer.scene.globe.ellipsoid
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

/**
 * 清理事件监听（供 destroy 调用）
 * - 移除相机变化监听器
 * - 清理屏幕事件处理器（LEFT_CLICK / MOUSE_MOVE）
 * @param renderer CesiumRenderer 实例
 */
export function destroyEvents(renderer: any): void {
  // 移除相机监听器
  if (renderer.viewer && renderer._cameraChangedHandler) {
    renderer.viewer.camera.changed.removeEventListener(renderer._cameraChangedHandler)
    renderer._cameraChangedHandler = null
  }

  // 清理屏幕事件处理器，防止内存泄漏
  if (renderer._screenSpaceEventHandler) {
    renderer._screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_CLICK)
    renderer._screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.MOUSE_MOVE)
    renderer._screenSpaceEventHandler = null
  }
}

// ===== 合并自 CesiumLayerRegistrar.ts（P8 物理搬移，逻辑零改动）=====
/**
 * CesiumLayerRegistrar — Cesium 3D 图层注册与移除
 * 拆分：从 CesiumRenderer.ts 纯搬移，逻辑零变化。
 * 负责 entity / dataSource / imageryLayer 的添加、移除、可见性切换。
 * 图层状态存储在 renderer._layers（Map<id, LayerState>）：
 * - instance：Entity 数组 / GeoJsonDataSource / ImageryLayer
 * - allFeatures：点图层的原始全量要素（供视口裁剪增量更新）
 * - cameraListener：视口裁剪点图层的相机变化监听器
 * - visible / options：可见性与图层选项
 * 跨模块依赖（均通过 renderer 实例委托，保持单一调度入口）：
 * - 视口裁剪：renderer._getViewportBBox / _isInViewport / _setupViewportListener
 * - 异步竞态 token：renderer._geoJsonTokens
 */

/**
 * 添加点图层（含视口裁剪：>1000 Entity 时仅渲染视口内要素）
 * @param renderer CesiumRenderer 实例
 * @param id 图层ID
 * @param features 点要素数组
 * @param options 图层选项（size/color/labelField/featureType）
 */
export function addPointLayer(renderer: any, id: string, features: any[], options: any = {}): void {
  // 幂等：先清除同 id 旧图层，防止 Entity 累积 + 相机监听器泄漏
  const existing = renderer._layers.get(id)
  if (existing) renderer._doRemoveLayer(existing)

  // P0性能优化：Entity数量控制 + 视口裁剪（>1000 时仅渲染视口内要素）
  const totalEntities = renderer.viewer.entities.values.length + features.length
  if (totalEntities > 1000 && import.meta.env.DEV) {
    logger.debug(`[CesiumRenderer] Entity数量(${totalEntities})超过1000，启动视口裁剪`)
  }

  // 视口裁剪：仅添加当前视口内的点
  const bbox = renderer._getViewportBBox()

  const entities: any[] = []
  features.forEach((item: any, index: number) => {
    // 防御性编程：优先使用 lng，兼容可能的 lon 字段
    const lng = item.lng ?? item.lon ?? 0
    if (bbox && !renderer._isInViewport(lng, item.lat, bbox)) return
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
  })
  renderer._applyPendingVisibility(id)
  // 触发渲染
  renderer.viewer.scene.requestRender()

  // 注册相机变化监听，视口变化时增量更新
  renderer._setupViewportListener(id)
}

/**
 * 创建并添加一个 Cesium 点 Entity（含 label / properties）
 * 供 addPointLayer 与 _updateCulledLayer 复用，保证实体构建逻辑单一来源。
 * @returns {object|null}
 */
export function createCesiumPointEntity(
  renderer: any,
  id: string,
  item: any,
  index: number,
  options: any
): any {
  const lng = item.lng ?? item.lon ?? 0
  return renderer.viewer.entities.add({
    // 末尾固定追加 index：同图层内存在同名要素时，name 相同的实体 id 会碰撞，
    // Cesium entities.add 对重复 id 会覆盖旧实体 → 要素丢失 + 视口裁剪增删错乱
    id: `${id}-${item.id || item.name || 'p'}-${index}`,
    position: Cartesian3.fromDegrees(lng, item.lat),
    point: {
      pixelSize: options.size || 12,
      color: Color.fromCssColorString(options.color || LAYER_DEFAULTS.color),
      outlineColor: Color.WHITE,
      outlineWidth: 2,
      // 2026-08-10（面试报告 P0-2）：CLAMP_TO_GROUND 贴地形——真地形就绪后
      // 点落在实际地表，而非椭球绝对高（北部湾 geoid 分离约 -30~-70m，绝对高会错位）
      heightReference: HeightReference.CLAMP_TO_GROUND,
    },
    label: options.labelField
      ? {
          text: item[options.labelField as string],
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

/**
 * 添加多边形图层（支持 Polygon / MultiPolygon）
 * @param renderer CesiumRenderer 实例
 * @param id 图层ID
 * @param features 多边形要素数组
 * @param options 图层选项（fillColor/strokeColor/strokeWidth/featureType）
 */
export function addPolygonLayer(
  renderer: any,
  id: string,
  features: any[],
  options: any = {}
): void {
  // 幂等：先清除同 id 旧图层，防止 Entity 累积
  const existing = renderer._layers.get(id)
  if (existing) renderer._doRemoveLayer(existing)

  const entities: any[] = []

  features.forEach((item: any) => {
    const coordinates = item.coordinates || item.geometry?.coordinates
    if (!coordinates) return

    if (!Array.isArray(coordinates) || coordinates.length === 0) return

    const geometryType = item.geometry?.type
    const createPolygon = (polyCoords: any) => {
      try {
        if (!Array.isArray(polyCoords) || !Array.isArray(polyCoords[0])) return
        const outerRing = polyCoords[0].map(([lng, lat]: [number, number]) =>
          Cartesian3.fromDegrees(lng, lat)
        )
        const holes = polyCoords.slice(1).map((holeCoords: [number, number][]) => {
          const holePoints = holeCoords.map(([lng, lat]) => Cartesian3.fromDegrees(lng, lat))
          return new PolygonHierarchy(holePoints)
        })
        const entity = renderer.viewer.entities.add({
          polygon: {
            hierarchy: new PolygonHierarchy(outerRing, holes),
            material: Color.fromCssColorString(options.fillColor || LAYER_DEFAULTS.fill),
            outline: true,
            outlineColor: Color.fromCssColorString(options.strokeColor || LAYER_DEFAULTS.stroke),
            outlineWidth: options.strokeWidth || 2,
            // 2026-08-10（面试报告 P0-2）：贴地形渲染——多边形沿真实地形起伏裁剪
            // （淹没区不会被山体盖住/悬空），替代默认椭球绝对高（原固定 0.5m 错位）
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
      coordinates.forEach((polyCoords: any) => createPolygon(polyCoords))
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
  renderer.viewer.scene.requestRender()
}

/**
 * 异步加载 GeoJSON 图层（含竞态保护 token）
 * @param renderer CesiumRenderer 实例
 * @param id 图层ID
 * @param geojson GeoJSON FeatureCollection
 * @param options 图层选项（featureType/fillColor/strokeColor/markerColor/markerSize/onError）
 */
export async function addGeoJsonLayer(
  renderer: any,
  id: string,
  geojson: any,
  options: any = {}
): Promise<void> {
  // 幂等：先清除同 id 旧图层，防止 dataSource 累积
  const existing = renderer._layers.get(id)
  if (existing) renderer._doRemoveLayer(existing)

  // 异步竞态保护：用 token 标记当前请求，await 后检查是否仍为最新
  renderer._geoJsonTokens = renderer._geoJsonTokens || new Map()
  const token = Symbol(id)
  renderer._geoJsonTokens.set(id, token)

  try {
    // 防御（2026-08-08）：viewer 可能已被 30s 空闲销毁（cesiumViewerManager 定时器
    // destroy）——渲染器对象还活着但 viewer 已失效，后续操作抛错 → 内部 catch 吞掉
    // → 图层永久缺失（"港口和行政区直接没了"候选根因之一）。在此提前检出，
    // 走 onError 让 BLM 感知（意图保留 + reapplyAll 重试）。
    // 注意：isDestroyed 必须严格 === true（mock 环境的 chainable 函数返回 truthy
    // 对象会误判，测试已踩坑）。
    const viewerDestroyed =
      !renderer.viewer ||
      (typeof renderer.viewer.isDestroyed === 'function' && renderer.viewer.isDestroyed() === true)
    if (viewerDestroyed) {
      renderer._geoJsonTokens.delete(id)
      ;(options.onError as ((msg: string) => void) | undefined)?.('Viewer 已销毁，图层创建失败')
      return
    }

    const dataSource = await GeoJsonDataSource.load(geojson)

    // await 后检查：若有更新的同 id 请求，丢弃本次结果
    if (renderer._geoJsonTokens.get(id) !== token) return

    logger.debug(`[CesiumRenderer] GeoJSON ${id} entities:`, dataSource.entities.values.length)
    dataSource.entities.values.forEach((entity: any) => {
      // properties 可能为 undefined（无属性的 GeoJSON 要素），判空避免崩溃
      if (!entity.properties) entity.properties = {}
      entity.properties.featureType = options.featureType || 'geojson'
      if (entity.polygon) {
        // 2026-08-10（面试报告 P0-2）：贴地形渲染——替代原固定 height=0.5 椭球绝对高
        // （真地形就绪后业务面与地形的垂直错位，北部湾 geoid 分离 -30~-70m）
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
          // 2026-08-10（面试报告 P0-2）：GeoJSON 点要素贴地形（同 createCesiumPointEntity）
          heightReference: HeightReference.CLAMP_TO_GROUND,
        })
      }
    })
    renderer.viewer.dataSources.add(dataSource)

    // 再次检查 token，防止 await 期间被新请求覆盖
    if (renderer._geoJsonTokens.get(id) !== token) {
      renderer.viewer.dataSources.remove(dataSource, true)
      return
    }

    renderer._layers.set(id, {
      instance: dataSource,
      visible: true,
      options,
    })
    renderer._applyPendingVisibility(id)
    renderer.viewer.scene.requestRender()
    // LIF-7：成功路径清理 token，避免 Map 跨 id 累积增长
    renderer._geoJsonTokens.delete(id)
  } catch (error: any) {
    // LIF-7：陈旧请求（已被更新的同 id 请求覆盖）失败不触发 onError，避免误报
    if (renderer._geoJsonTokens.get(id) !== token) return
    renderer._geoJsonTokens.delete(id)
    if (import.meta.env.DEV) {
      logger.error(`GeoJSON图层 ${id} 加载失败`, error)
    }
    ;(options.onError as ((msg: string) => void) | undefined)?.('GeoJSON数据加载失败')
  }
}

/**
 * 添加 GeoTIFF 栅格图层（3D 回退方案）
 * quantized-mesh 真地形门禁失败（沙箱无 ctb / pip，无法生成地形瓦片），
 * 降级为山体阴影贴图：用预生成的 dem_hillshade.png 作为 SingleTileImageryProvider
 * 贴在椭球面上。视觉有地形明暗感，但无真 z 值起伏（伪三维，非数字孪生级）。
 * 与 2D 共用同一份 BusinessLayerManager 注册（layerType:'geotiff', data:'...tif'），
 * 此处将 .tif 映射为 .png（Cesium 影像不支持 GeoTIFF 解码，需预生成 PNG 影像）。
 * 地理范围取自 dem_hillshade 的 gdalinfo 实测值（EPSG:4326，与 2D COG 完全一致）。
 * 2D↔3D 切换时由 App.vue 的 reapplyAll 重绘到新 renderer，无需额外接线。
 * @param renderer CesiumRenderer 实例
 * @param id 图层ID
 * @param url GeoTIFF 文件 URL（仅支持 hillshade 回退）
 * @param options 图层选项（opacity）
 * @returns 是否添加成功
 */
export function addGeoTIFFLayer(
  renderer: any,
  id: string,
  url: string,
  options: any = {}
): boolean {
  // 入口可见性日志（排查"图层没挂载"）：无论走哪个分支都打印，用户刷新后
  // 控制台搜 addGeoTIFFLayer 即可定位（调用了/跳过了/URL 是什么）
  logger.debug(
    `[CesiumRenderer] addGeoTIFFLayer 调用: id=${id} url=${url} terrainReady=${renderer._terrainReady}`
  )

  // 回退方案仅支持预生成的 hillshade 影像；其它 GeoTIFF 在 3D 下暂不支持
  if (!/hillshade/i.test(url)) {
    logger.debug(`[CesiumRenderer] addGeoTIFFLayer 仅支持 hillshade 回退，跳过: ${url}`)
    return false
  }

  // 2026-08-08（方案 A）：移除"真地形就绪即跳过"分支——DEM 是独立图层（有地理信息
  // 的影像：4326 范围 + GeographicTilingScheme），像普通图层一样由图层面板开关控制
  // 显隐（BLM registry → setVisibility → _layers 实例.show）。真地形（terrainProvider
  // z 起伏）是地图基础能力，独立常驻，不再与 DEM 图层开关耦合。
  // 原设计：_terrainReady 时 return true 跳过 → 3D 下 DEM 无视觉实例 → 面板开关空转
  // （用户实测"点击不显示图层，反而底图重载"）。

  // 整体防御 —— 渲染失败只记录完整错误，不向调用方（reapplyAll）抛错，
  // 避免单个图层的问题中断整批引擎切换重绘。
  try {
    // 幂等：先清除同 id 旧图层
    const existing = renderer._layers.get(id)
    if (existing) renderer._doRemoveLayer(existing)

    // Cesium 影像不支持 GeoTIFF，映射为预生成的 PNG 影像（两者地理范围一致）
    const pngUrl = url.replace(/\.tif$/i, '.png')

    // dem_hillshade 实测范围（gdalinfo Upper Left / Lower Right，EPSG:4326）
    // SingleTileImageryProvider 默认 WebMercatorTilingScheme(3857)，
    // 而 hillshade PNG 为 EPSG:4326 地理坐标 —— 不指定 tilingScheme 会被投影到错误位置
    // （北部湾 21°N 的 WebMercator Y ≠ 地理纬度），3D 下贴图不可见。必须显式 GeographicTilingScheme。
    // Cesium 1.142 @cesium/engine 新实现强制校验 options.tileWidth/tileHeight
    // （Check.typeOf.number，缺省即抛 DeveloperError "Expected options.tileWidth..."）；
    // 旧 Build/index.cjs 无此校验 → Node 环境测不出，仅浏览器 vite（Source 入口）触发。
    // 传 PNG 实际像素尺寸（PNG header 实测 4096×2819）。
    const provider = new SingleTileImageryProvider({
      url: pngUrl,
      rectangle: Rectangle.fromDegrees(106.9720001, 20.9379894, 110.0783727, 23.0760978),
      tilingScheme: new GeographicTilingScheme(),
      tileWidth: 4096,
      tileHeight: 2819,
    } as any)
    // 诊断对称性：OL 侧 addGeoTIFFLayer 有 source.on('error') 监听（OLRenderer.ts:365），
    // Cesium 侧原缺 errorEvent 监听 —— PNG 加载/解码失败时静默无图、无日志，
    // 表现为"2D 有山体阴影、3D 空白且难排查"。在此补全，把静默失败变成可见 warn。
    if (provider.errorEvent) {
      provider.errorEvent.addEventListener((err: unknown) => {
        logger.warn(`[CesiumRenderer] hillshade 影像加载失败: ${pngUrl}`, err)
      })
    }
    const imageryLayer = renderer.viewer.imageryLayers.addImageryProvider(provider)
    // 全量 hillshade 贴图模式（用户拍板，2026-08-05）：
    // - 顶层叠加 + 高不透明（默认 alpha 0.85）：山体明暗清晰可辨（DEM 地形图观感），
    //   天地图影像在下方透出轮廓，注记层（cia_w）在更上层显示地名。
    //   教训：0.45 半透明太淡，用户视觉上'看不到 DEM 图层'——验证要从用户视觉出发，
    //   不能只看'代码不报错'。
    // - 真 3D 已由 terrain 瓦片方案（_setupTerrain）承接（2026-08-10：
    //   原 _setupFullDem 全量 mesh 死代码已删），hillshade 为降级兜底。
    imageryLayer.alpha = options.opacity ?? 0.85
    // 记录 hillshade 图层引用（真地形 mesh 恢复后隐藏/降级用）
    renderer._hillshadeLayer = imageryLayer
    // 注意：此函数尾部原有一处 lowerToBottom(imageryLayer) 残留（5c7f6e7 引入，
    // 5730705 只删了前一处）——把 hillshade 沉到最底层被天地图盖住，用户永远
    // 看不到 DEM 图层。已删除：hillshade 保持顶层（天地图之上），alpha 半透明叠加。

    renderer._layers.set(id, {
      instance: imageryLayer,
      visible: true,
      options,
    })
    renderer._applyPendingVisibility(id)
    renderer.viewer.scene.requestRender()
    logger.debug(`[CesiumRenderer] addGeoTIFFLayer 已添加 hillshade 回退贴图: ${id} → ${pngUrl}`)
    return true
  } catch (error: any) {
    // 完整错误信息（name/message）用于定位投影或 imageryLayers 层问题
    logger.error(
      `[CesiumRenderer] addGeoTIFFLayer 失败 ${id} → ${url}: ${error?.name}: ${error?.message}`,
      error
    )
    return false
  }
}

/**
 * 设置图层可见性（供 MapRenderer基类 setVisibility 调用）
 * Entity 数组逐个设置 show；dataSource / imageryLayer 直接设 show。
 * @param renderer CesiumRenderer 实例
 * @param id 图层ID
 * @param visible 是否可见
 */
export function doSetVisibility(renderer: any, id: string, visible: boolean): void {
  const layer = renderer._layers.get(id)
  if (layer && layer.instance) {
    if (Array.isArray(layer.instance)) {
      layer.instance.forEach((entity: any) => {
        if (entity) entity.show = visible
      })
    } else {
      layer.instance.show = visible
    }
    renderer.viewer.scene.requestRender()
  }
}

/**
 * 移除图层实例（供 MapRenderer基类 removeLayer / destroy 调用）
 * - 移除视口裁剪监听（点图层特有）
 * - Entity 数组逐个 remove；imageryLayer 用 remove(,true) 释放 GPU 纹理；
 * dataSource 用 remove(,true) 销毁防止内存泄漏
 * @param renderer CesiumRenderer 实例
 * @param layer 图层状态条目
 */
export function doRemoveLayer(renderer: any, layer: any): void {
  // 移除视口监听（视口裁剪点图层特有，其它图层为 undefined）
  if (layer.cameraListener) {
    renderer.viewer.camera.changed.removeEventListener(layer.cameraListener)
    layer.cameraListener = null
  }
  if (layer.instance) {
    if (Array.isArray(layer.instance)) {
      layer.instance.forEach((entity: any) => {
        if (entity) renderer.viewer.entities.remove(entity)
      })
    } else if (renderer.viewer.imageryLayers.contains(layer.instance)) {
      // 影像图层（如 hillshade 回退贴图），destroy=true 释放 GPU 纹理
      renderer.viewer.imageryLayers.remove(layer.instance, true)
    } else {
      // 第二参数 destroy=true 让 Cesium 在移除时销毁 dataSource，防止内存泄漏
      renderer.viewer.dataSources.remove(layer.instance, true)
    }
    renderer.viewer.scene.requestRender()
  }
}

// ===== 合并自 CesiumViewportCulling.ts（P8 物理搬移，逻辑零改动）=====
/**
 * CesiumViewportCulling — Cesium 3D 视口裁剪
 * 拆分：从 CesiumRenderer.ts 纯搬移，逻辑零变化。
 * 负责视口范围估算、点要素视口裁剪、相机移动时的增量更新。
 * 裁剪状态存储在 renderer._layers 的图层条目上：
 * - layer.allFeatures：原始全量要素（供视口变化时增量更新）
 * - layer.cameraListener：相机变化监听器（requestAnimationFrame 防抖）
 */

/** 视口经纬度范围 */
export interface ViewportBBox {
  west: number
  east: number
  south: number
  north: number
}

/**
 * 计算当前相机视口的经纬度范围
 * ⚠️ 注意：Cesium `camera.positionCartographic` 的 longitude/latitude 单位为**弧度**，
 * 必须用 CesiumMath.toDegrees 转换为角度后再与要素经纬度比较。
 *
 * a019: 优先用 camera.computeViewRectangle(scene.globe) 取**真实视口四角投影**
 * 覆盖范围——替代原圆形/方形估算（原 `halfRange = (height/111000)*1.5` 在
 * pitch≠-90 倾斜视角下会把视口边缘 POI 错误裁剪）。computeViewRectangle 不可用
 * （场景未渲染/globe 缺失）时回退原估算。
 *
 * @param renderer CesiumRenderer 实例（访问 viewer）
 * @returns 视口范围；太高（>5000km）或无相机时返回 null（不裁剪）
 */
export function getViewportBBox(renderer: any): ViewportBBox | null {
  if (!renderer.viewer) return null
  const camera = renderer.viewer.camera
  const scene = renderer.viewer.scene
  const cartographic = camera.positionCartographic
  if (!cartographic) return null
  const height = cartographic.height
  if (height > 5000000) return null // 太高不做裁剪

  // a019: 真实视口四角投影（倾斜视角下边缘 POI 不再误裁）
  try {
    const rect = camera.computeViewRectangle(scene?.globe)
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

  // 兜底：相机高度圆形估算（原逻辑,仅真实投影不可用时的近似）
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

/**
 * 判断点是否在当前视口内
 * @param lng 经度
 * @param lat 纬度
 * @param bbox 视口范围（null 时不裁剪，返回 true）
 */
export function isInViewport(lng: number, lat: number, bbox: ViewportBBox | null): boolean {
  if (!bbox) return true // 无视口信息时不裁剪
  return lng >= bbox.west && lng <= bbox.east && lat >= bbox.south && lat <= bbox.north
}

/**
 * 为点图层注册视口变化监听
 * 相机移动时，增量添加/移除视口内外的要素（requestAnimationFrame 防抖）
 * @param renderer CesiumRenderer 实例
 * @param id 图层ID
 */
export function setupViewportListener(renderer: any, id: string): void {
  const layer = renderer._layers.get(id)
  if (!layer || !layer.allFeatures) return

  // 防抖：相机移动时频繁触发，用 requestAnimationFrame 合并
  let rafId: number | null = null
  const updateHandler = () => {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(() => {
      updateCulledLayer(renderer, id)
      rafId = null
    })
  }

  // 移除旧监听（如果存在）
  if (layer.cameraListener) {
    renderer.viewer.camera.changed.removeEventListener(layer.cameraListener)
  }

  renderer.viewer.camera.changed.addEventListener(updateHandler)
  layer.cameraListener = updateHandler
}

/**
 * 视口变化时增量更新裁剪图层：移除离开视口的 Entity，添加新进入视口的 Entity
 * @param renderer CesiumRenderer 实例（访问 _layers / viewer / _createCesiumPointEntity）
 * @param id 图层ID
 */
export function updateCulledLayer(renderer: any, id: string): void {
  const layer = renderer._layers.get(id)
  if (!layer || !layer.allFeatures || !layer.visible) return

  const bbox = getViewportBBox(renderer)
  if (!bbox) return

  // 计算应显示的要素 ID 集合（ID 与 _createCesiumPointEntity 保持一致：id-name-index）
  const shouldShow = new Set<string>()
  layer.allFeatures.forEach((item: any, index: number) => {
    const lng = item.lng ?? item.lon ?? 0
    if (isInViewport(lng, item.lat, bbox)) {
      shouldShow.add(`${id}-${item.id || item.name || 'p'}-${index}`)
    }
  })

  // 移除不在视口内的 Entity
  for (const entity of layer.instance) {
    if (!shouldShow.has(entity.id)) {
      renderer.viewer.entities.remove(entity)
    }
  }

  // 添加新进入视口的 Entity
  const existingIds = new Set<string>(layer.instance.map((e: any) => e.id))
  layer.allFeatures.forEach((item: any, index: number) => {
    const entityId = `${id}-${item.id || item.name || 'p'}-${index}`
    if (shouldShow.has(entityId) && !existingIds.has(entityId)) {
      const entity = renderer._createCesiumPointEntity(id, item, index, layer.options)
      if (entity) layer.instance.push(entity)
    }
  })

  // 清理已移除的 Entity 引用
  layer.instance = layer.instance.filter((e: any) => renderer.viewer.entities.contains(e))
}

// ===== 合并自 CesiumWaterSurface.ts（P8 物理搬移，逻辑零改动）=====
/**
 * CesiumWaterSurface — Cesium 3D 水面 Primitive 管理
 * 拆分：从 CesiumRenderer.ts 纯搬移，逻辑零变化。
 * 使用 Primitive API（适合大规模几何体），通过重建 Primitive 实现水位更新。
 * 水面状态存储在 renderer._waterSurfaces（Map<id, {primitive, height, coordinates, options, visible}>）。
 *
 * 2026-08-06 增量更新（D-7）：updateWaterLevel 不再 remove+add 重建 Primitive——
 * 重建会让旧几何销毁、新几何异步构建，中间有空窗 → 水位拖动时水面"一闪一闪"。
 * 改为：复用同一 Primitive，仅替换 geometryInstances（同步构建新几何并赋值，
 * Cesium 在下一帧用新几何重绘），Primitive 对象、可见性、颜色缓冲全部复用。
 */

/** 水面状态条目 */
interface WaterSurfaceEntry {
  primitive: Primitive
  height: number
  coordinates: [number, number][]
  options: Record<string, unknown>
  visible: boolean
}

/**
 * 构建水面 GeometryInstance（供 create 与 update 复用，避免重复代码）
 */
function buildWaterInstance(
  coordinates: [number, number][],
  height: number,
  options: WaterSurfaceOptions
): GeometryInstance {
  const positions = coordinates.map((coord) => Cartesian3.fromDegrees(coord[0], coord[1], height))
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

/**
 * 添加水面 Primitive
 * @param renderer CesiumRenderer 实例（访问 viewer / _waterSurfaces）
 */
export function addWaterSurface(
  renderer: any,
  id: string,
  coordinates: [number, number][],
  height = 0,
  options: WaterSurfaceOptions = {}
): boolean {
  removeWaterSurface(renderer, id)
  try {
    const instance = buildWaterInstance(coordinates, height, options)

    const appearance = new PerInstanceColorAppearance({
      translucent: true,
      closed: false,
    })

    const primitive = new Primitive({
      geometryInstances: instance,
      appearance: appearance,
      asynchronous: false,
    })

    renderer.viewer.scene.primitives.add(primitive)

    // 保存水面状态供后续更新使用
    renderer._waterSurfaces = renderer._waterSurfaces || new Map()
    renderer._waterSurfaces.set(id, {
      primitive: primitive,
      height: height,
      coordinates: coordinates,
      options: options,
      visible: true,
    })

    renderer.viewer.scene.requestRender()
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
 * 更新水位高度（增量更新，D-7 2026-08-06）
 * 复用同一 Primitive，仅替换 geometryInstances（同步构建新几何）：
 * - 不 remove/add → 无空窗 → 水位拖动不再"一闪一闪"
 * - 不重建 Primitive → 保留 GPU 缓冲复用路径，减少 GC/状态清理
 * @param renderer CesiumRenderer 实例
 * @param id 水面图层ID
 * @param newHeight 新的高度（米）
 */
export function updateWaterLevel(renderer: any, id: string, newHeight: number): boolean {
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
    // 同步构建新几何并替换到同一 Primitive（不销毁旧 Primitive）
    // Cesium 类型将 geometryInstances 标为只读，但运行时支持替换（增量更新依赖此行为，
    // 06908b5 引入时未跑 typecheck 的遗留错误）——用断言绕过类型只读标注
    ;(waterSurface.primitive as { geometryInstances: unknown }).geometryInstances =
      buildWaterInstance(waterSurface.coordinates, newHeight, waterSurface.options)
    waterSurface.height = newHeight
    renderer.viewer.scene.requestRender()
    return true
  } catch (e) {
    // 构建失败保持旧水位（不闪、不崩），仅日志
    if (import.meta.env.DEV) {
      logger.warn(`[CesiumRenderer] 水面 ${id} 水位更新失败（保持旧水位）:`, e)
    }
    return false
  }
}

/**
 * 移除水面 Primitive
 * @param renderer CesiumRenderer 实例
 * @param id 水面图层ID
 */
export function removeWaterSurface(renderer: any, id: string): boolean {
  const waterSurface: WaterSurfaceEntry | undefined = renderer._waterSurfaces?.get(id)
  if (waterSurface) {
    renderer.viewer.scene.primitives.remove(waterSurface.primitive)
    renderer._waterSurfaces.delete(id)
    renderer.viewer.scene.requestRender()
    return true
  }
  return false
}

/**
 * 移除所有水面
 * @param renderer CesiumRenderer 实例
 */
export function removeAllWaterSurfaces(renderer: any): boolean {
  if (renderer._waterSurfaces) {
    renderer._waterSurfaces.forEach((_: WaterSurfaceEntry, id: string) =>
      removeWaterSurface(renderer, id)
    )
    return true
  }
  return false
}

/**
 * 设置水面可见性
 * @param renderer CesiumRenderer 实例
 * @param id 水面图层ID
 * @param visible 是否可见
 */
export function setWaterSurfaceVisibility(renderer: any, id: string, visible: boolean): boolean {
  const waterSurface: WaterSurfaceEntry | undefined = renderer._waterSurfaces?.get(id)
  if (waterSurface) {
    waterSurface.visible = visible
    waterSurface.primitive.show = visible
    renderer.viewer.scene.requestRender()
    return true
  }
  return false
}

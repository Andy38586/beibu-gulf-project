// 技术债：Cesium 渲染器类型注解待逐步补充，typecheck 依赖 @ts-nocheck，故豁免 ban-ts-comment
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// 渐进迁移：Cesium 渲染器，类型注解待逐步补充（D-6 技术债）
import {
  BoundingSphere,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  CesiumTerrainProvider,
  Color,
  ComponentDatatype,
  Geometry,
  GeometryAttribute,
  GeometryInstance,
  Math as CesiumMath,
  PerInstanceColorAppearance,
  Primitive,
  PrimitiveType,
  UrlTemplateImageryProvider,
  Viewer,
} from 'cesium'

import { buildTiandituUrl, MAP_CONFIG, zoomToHeight } from '@/core/config/map'
import { LAYER_DEFAULTS } from '@/shared'
import { logger } from '@/shared'

import { destroyEvents, setupCameraDebounce, setupClickHandler } from './CesiumEvents'
import {
  addGeoJsonLayer,
  addGeoTIFFLayer,
  addPointLayer,
  addPolygonLayer,
  createCesiumPointEntity,
  doRemoveLayer,
  doSetVisibility,
} from './CesiumLayerRegistrar'
import {
  getViewportBBox,
  isInViewport,
  setupViewportListener,
  updateCulledLayer,
} from './CesiumViewportCulling'
import {
  addWaterSurface,
  removeAllWaterSurfaces,
  removeWaterSurface,
  setWaterSurfaceVisibility,
  updateWaterLevel,
} from './CesiumWaterSurface'
import { MapRenderer } from './MapRenderer'

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
      // 240Hz 渲染治理（2026-08-05，拖拽掉帧 50avg/20min 优化）：
      // - requestRenderMode: true —— 静止零渲染（省 GPU/CPU）。相机交互（拖拽/缩放/
      //   旋转）由 Cesium 内部自动 requestRender，不影响交互；图层/水面/相机防抖/动画
      //   等全部动态更新路径均已显式 requestRender（CesiumLayerRegistrar/CesiumWaterSurface
      //   /CesiumEvents/startBreathing 均有调用），无"画面不刷新"风险。
      // - highDynamicRange/fxaa/antialias 关闭 —— 240Hz 屏每帧预算仅 ~6ms（160fps），
      //   HDR 后处理 + FXAA + MSAA 是拖拽掉帧的主要 GPU 开销来源。
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
      highDynamicRange: false,
      fxaa: false,
      contextOptions: { webgl: { antialias: false } },
    })

    // LOD 粗一级（默认 2 → 4）：globe 网格面数约减半，拖拽更流畅；
    // 真地形瓦片接入后配合瓦片 LOD 效果更明显（视觉可接受，远处地形略简）。
    this.viewer.scene.maximumScreenSpaceError = 4
    // 关大气地面散射与雾（240Hz 下每帧计算的视觉开销，非业务必需）
    this.viewer.scene.globe.showGroundAtmosphere = false
    this.viewer.scene.fog.enabled = false

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
  setBaseLayers(layers) {
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
 * 类型契约见 renderers.d.ts -> CesiumRendererState（本类顶部 // @ts-nocheck，仅作文档参考）。
 */
export class CesiumRenderer extends MapRenderer {
  constructor(container) {
    super(container)
    /** @type {import('./renderers').CesiumRendererState['viewer']} */
    this.viewer = null
    this.baseLayers = { image: [], vector: [] }
    /** @type {import('./renderers').CesiumRendererState['_isReusing']} */
    this._isReusing = false // 标记是否复用已有Viewer
    /** @type {import('./renderers').CesiumRendererState['_cameraDebounceTimer']} */
    this._cameraDebounceTimer = null // 相机变化防抖定时器
    /** 真地形就绪标志：_setupTerrain 成功后置 true；业务层 addGeoTIFFLayer 据此
     *  跳过 hillshade 回退贴图（真地形 z 起伏 + Cesium 光照取代伪三维明暗图）。 */
    this._terrainReady = false
    /** hillshade 回退贴图引用：真地形就绪后隐藏，避免盖住天地图底图 */
    this._hillshadeLayer = null
    /** 底图瓦片失败 warn 只打一次（防每个瓦片刷屏） */
    this._imageryErrorLogged = false
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

  /**
   * 全量 DEM 真地形（用户拍板方案，2026-08-05）：
   * 一次性 fetch 整个高程网格（backend/static/dem/dem_elev.bin，1000×750 Int16，
   * GDAL 降采样自 dem_4326_cut.tif），构建单一 Cesium Primitive 三角网格——
   * 不切瓦片、无 LOD、无 terrainProvider（瓦片链路在真实浏览器不稳定）。
   * nodata（>=32000，南海海洋区）→ 0 海平面。失败静默降级（保持椭球+底图）。
   */
  async _setupFullDem() {
    try {
      const viewer = this.viewer
      if (!viewer) return
      const resp = await fetch('/static/dem/dem_elev.bin')
      if (!resp.ok) throw new Error(`dem_elev.bin HTTP ${resp.status}`)
      const buf = new Int16Array(await resp.arrayBuffer())
      const W = 1000
      const H = 750
      if (buf.length !== W * H) throw new Error(`dem_elev.bin 尺寸不符: ${buf.length}`)
      // dem_4326_cut.tif 地理范围（gdalinfo 实测，EPSG:4326）
      const LON_MIN = 106.9720001
      const LON_MAX = 110.0783727
      const LAT_MIN = 20.9379894
      const LAT_MAX = 23.0760978
      // 顶点位置（ECEF，75 万点 ≈ 9MB）
      // 官方 sandcastle 自定义 Geometry 标准：DOUBLE + Float64Array（Cesium 内部转换）
      const positions = new Float64Array(W * H * 3)
      let k = 0
      for (let y = 0; y < H; y++) {
        const lat = LAT_MAX - (y / (H - 1)) * (LAT_MAX - LAT_MIN)
        for (let x = 0; x < W; x++) {
          const lon = LON_MIN + (x / (W - 1)) * (LON_MAX - LON_MIN)
          let e = buf[y * W + x]
          if (e >= 32000) e = 0 // nodata → 海平面
          const c = Cartesian3.fromDegrees(lon, lat, e)
          positions[k++] = c.x
          positions[k++] = c.y
          positions[k++] = c.z
        }
      }
      // 三角索引（每 2×2 格点 2 三角形，150 万索引 ≈ 6MB）
      const indices = new Uint32Array((W - 1) * (H - 1) * 6)
      let ii = 0
      for (let y = 0; y < H - 1; y++) {
        for (let x = 0; x < W - 1; x++) {
          const a = y * W + x
          const b = a + 1
          const c = a + W
          const d = c + 1
          indices[ii++] = a
          indices[ii++] = b
          indices[ii++] = c
          indices[ii++] = b
          indices[ii++] = d
          indices[ii++] = c
        }
      }
      const geometry = new Geometry({
        attributes: {
          position: new GeometryAttribute({
            componentDatatype: ComponentDatatype.DOUBLE,
            componentsPerAttribute: 3,
            values: positions,
          }),
        },
        indices,
        primitiveType: PrimitiveType.TRIANGLES,
        // boundingSphere 显式提供（Primitive 视锥剔除需要）
        boundingSphere: BoundingSphere.fromVertices(positions),
      })
      // 裸 Geometry 同步渲染必须手动补 boundingSphereCV：
      // Primitive 同步路径对裸 Geometry 走 cloneGeometry（不做 pipeline），而
      // createVertexArray 渲染时访问 geometry.boundingSphereCV.center —— 该字段
      // 官方 pipeline 用 BoundingSphere.fromVertices 设置（内置生成器如 PolygonGeometry
      // 的 createGeometry 内部处理），裸 Geometry 需手动等值赋值。异步 worker 路径
      // 在 vite dev 下不可靠（_workerName/createFunction 均踩坑），用同步模式。
      geometry.boundingSphereCV = BoundingSphere.fromVertices(positions)
      const primitive = new Primitive({
        geometryInstances: new GeometryInstance({ geometry }),
        appearance: new PerInstanceColorAppearance({
          // flat: 关闭逐顶点光照（无 normals 也能渲染，官方自定义 Geometry 标准用法）
          flat: true,
          translucent: false,
        }),
        // 同步模式（vite dev 下 Cesium worker 加载不可靠）；boundingSphereCV 已手动补
        asynchronous: false,
      })
      viewer.scene.primitives.add(primitive)
      this._demPrimitive = primitive
      logger.debug(`[CesiumRenderer] 全量 DEM mesh 加载成功: ${W}x${H}`)
    } catch (e) {
      // 无数据/加载失败 → 保持椭球 + 天地图底图（现状行为），仅日志提示
      logger.warn('[CesiumRenderer] 全量 DEM 加载失败:', e instanceof Error ? e.message : e)
    }
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
      viewer.terrainProvider = provider
      this._terrainReady = true
      // 真地形就绪后 hillshade 伪三维回退贴图退场：它是 70% 不透明灰白单张图，
      // 盖在天地图底图之上（addImageryProvider 默认顶层），不隐藏会"底图消失"。
      if (this._hillshadeLayer) {
        this._hillshadeLayer.show = false
        logger.debug('[CesiumRenderer] 真地形就绪，隐藏 hillshade 回退贴图')
      }
      viewer.scene.requestRender()
      logger.debug('[CesiumRenderer] 真地形接入成功: /static/terrain/layer.json')
    } catch (e) {
      // 无瓦片产物或加载失败 → 保持椭球面 + hillshade 回退（现状行为）
      // 带上失败原因便于排查（常见：dev 未重启 vite / 后端未起 / 瓦片目录缺失）
      logger.warn('[CesiumRenderer] 真地形接入跳过:', e instanceof Error ? e.message : e)
    }
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

    // 底图瓦片加载失败可见性（排查用）：注意 ImageryLayerCollection 没有 errorEvent
    // （仅有 layerAdded/layerRemoved/layerMoved/layerShown/layerHidden），errorEvent
    // 在 ImageryProvider 上（与 addGeoTIFFLayer 的 hillshade 监听同模式）。挂 collection
    // 会抛 TypeError 导致 3D 初始化失败——已踩坑（2026-08-05 20:29）。首次失败 warn 一次。
    const attachImageryErrorLog = (provider: UrlTemplateImageryProvider) => {
      if (!provider?.errorEvent) return
      provider.errorEvent.addEventListener((err: unknown) => {
        if (this._imageryErrorLogged) return
        this._imageryErrorLogged = true
        logger.warn('[CesiumRenderer] 底图瓦片加载失败（首次）:', err instanceof Error ? err.message : err)
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
    const imageBaseLayer = this.viewer.imageryLayers.addImageryProvider(imageBaseProvider)
    const imageAnnotationProvider = new UrlTemplateImageryProvider({
      url: tiandituUrlForCesium(MAP_CONFIG.BASE_LAYERS.image.layers[1]),
      maximumLevel: 18,
    })
    attachImageryErrorLog(imageAnnotationProvider)
    const imageAnnotationLayer = this.viewer.imageryLayers.addImageryProvider(imageAnnotationProvider)
    const vectorBaseProvider = this.viewer.imageryLayers.addImageryProvider(
      new UrlTemplateImageryProvider({
        url: tiandituUrlForCesium(MAP_CONFIG.BASE_LAYERS.vector.layers[0]),
        maximumLevel: 18,
      })
    )
    const vectorAnnotationProvider = this.viewer.imageryLayers.addImageryProvider(
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

  addPointLayer(id, features, options = {}) {
    // 委托至 CesiumLayerRegistrar.ts（纯搬移，逻辑零变化）
    return addPointLayer(this, id, features, options)
  }

  /**
   * 创建并添加一个 Cesium 点 Entity（含 label / properties）
   * 供 addPointLayer 与 _updateCulledLayer 复用，保证实体构建逻辑单一来源。
   * @returns {object|null}
   */
  _createCesiumPointEntity(id, item, index, options) {
    // 委托至 CesiumLayerRegistrar.ts（纯搬移，逻辑零变化）
    return createCesiumPointEntity(this, id, item, index, options)
  }

  /**
   * 计算当前相机视口的经纬度范围（简化估算）
   * ⚠️ 注意：Cesium `camera.positionCartographic` 的 longitude/latitude 单位为**弧度**，
   * 必须用 CesiumMath.toDegrees 转换为角度后再与要素经纬度比较。
   * @returns {{west:number, east:number, south:number, north:number} | null}
   */
  _getViewportBBox() {
    // 委托至 CesiumViewportCulling.ts（纯搬移，逻辑零变化）
    return getViewportBBox(this)
  }

  /**
   * 判断点是否在当前视口内
   */
  _isInViewport(lng, lat, bbox) {
    // 委托至 CesiumViewportCulling.ts（纯搬移，逻辑零变化）
    return isInViewport(lng, lat, bbox)
  }

  /**
   * 为点图层注册视口变化监听
   * 相机移动时，增量添加/移除视口内外的要素（requestAnimationFrame 防抖）
   */
  _setupViewportListener(id) {
    // 委托至 CesiumViewportCulling.ts（纯搬移，逻辑零变化）
    setupViewportListener(this, id)
  }

  /**
   * 视口变化时增量更新裁剪图层：移除离开视口的 Entity，添加新进入视口的 Entity
   */
  _updateCulledLayer(id) {
    // 委托至 CesiumViewportCulling.ts（纯搬移，逻辑零变化）
    updateCulledLayer(this, id)
  }

  addPolygonLayer(id, features, options = {}) {
    // 委托至 CesiumLayerRegistrar.ts（纯搬移，逻辑零变化）
    return addPolygonLayer(this, id, features, options)
  }

  async addGeoJsonLayer(id, geojson, options = {}) {
    // 委托至 CesiumLayerRegistrar.ts（纯搬移，逻辑零变化）
    return addGeoJsonLayer(this, id, geojson, options)
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
  addGeoTIFFLayer(id, url, options = {}) {
    // 委托至 CesiumLayerRegistrar.ts（纯搬移，逻辑零变化）
    return addGeoTIFFLayer(this, id, url, options)
  }

  _doSetVisibility(id, visible) {
    // 委托至 CesiumLayerRegistrar.ts（纯搬移，逻辑零变化）
    return doSetVisibility(this, id, visible)
  }

  _doRemoveLayer(layer) {
    // 委托至 CesiumLayerRegistrar.ts（纯搬移，逻辑零变化）
    return doRemoveLayer(this, layer)
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
    // 防御性编程：优先使用 lng，兼容可能的 lon 字段
    const lng = target.lng ?? target.lon ?? 0
    const lat = target.lat
    const destination = Cartesian3.fromDegrees(lng, lat, height)
    this.viewer.camera.flyTo({
      destination,
      // Cesium duration 单位为秒（原 1000 秒 ≈ 16.6 分钟）
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
      this.viewer.container.clientHeight / 2
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

    logger.debug('[CesiumRenderer._getCameraState] 导出状态:', {
      center: state.center,
      height: state.height,
      heightKm: (state.height / 1000).toFixed(2) + 'km',
      pitch: pitchDeg.toFixed(2) + '°',
      usingPick: cartesian !== null,
    })

    return state
  }

  _setCameraState(state) {
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
      height: height,
      heightKm: (height / 1000).toFixed(2) + 'km',
      pitch: pitch + '°',
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
      if (l) l.show = type === 'image'
    })
    this.baseLayers.vector.forEach((l) => {
      if (l) l.show = type === 'vector'
    })
    this.viewer.scene.requestRender()
  }

  startBreathing(lng, lat) {
    this.stopBreathing()
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

  // 水面方法委托至 CesiumWaterSurface.ts（纯搬移，逻辑零变化）
  addWaterSurface(id, coordinates, height = 0, options = {}) {
    return addWaterSurface(this, id, coordinates, height, options)
  }

  updateWaterLevel(id, newHeight) {
    return updateWaterLevel(this, id, newHeight)
  }

  removeWaterSurface(id) {
    return removeWaterSurface(this, id)
  }

  removeAllWaterSurfaces() {
    return removeAllWaterSurfaces(this)
  }

  setWaterSurfaceVisibility(id, visible) {
    return setWaterSurfaceVisibility(this, id, visible)
  }

  /**
   * 覆写基类 hasLayer：水面存于 _waterSurfaces（不在 _layers），基类查不到。
   * BLM.updateData 用 hasLayer 判"图层缺失补 create vs 已存在走 update"——
   * 不覆写时水面每次水位变化都被判缺失 → 走 create → addWaterSurface
   * remove+add 全量重建 Primitive，增量更新（updateWaterLevel 替换
   * geometryInstances）永远走不到（06908b5 写的增量是死代码）。
   */
  hasLayer(id) {
    return super.hasLayer(id) || (this._waterSurfaces?.has(id) ?? false)
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

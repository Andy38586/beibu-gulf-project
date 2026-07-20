import { MapRenderer } from './MapRenderer'
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
} from 'cesium'
import { MAP_CONFIG, buildTiandituUrl } from '@/core/config/map'

/**
 * CesiumViewer单例管理器
 *
 * 职责：
 * 1. 管理全局唯一的Viewer实例（单例模式）
 * 2. 支持按需挂载/卸载DOM（不销毁Viewer）
 * 3. 隐藏时暂停渲染（requestRenderMode），降低GPU占用
 *
 * 生命周期：
 * - create() → 首次创建Viewer（仅调用一次）
 * - mount(el) → 挂载到指定DOM容器（可多次调用）
 * - unmount() → 从DOM移除，保留实例（可多次调用）
 * - destroy() → 真正销毁（一般不调用）
 */
class CesiumViewerManager {
  constructor() {
    /** @type {Viewer|null} 全局唯一的Viewer实例 */
    this.viewer = null
    /** @type {boolean} 当前是否已挂载到DOM */
    this.isMounted = false
    /** @type {boolean} 底图是否已初始化（防止重复添加） */
    this._baseLayersInitialized = false
  }

  /**
   * 创建Viewer单例（首次调用时创建，后续调用返回已有实例）
   * @param {HTMLElement} container - DOM容器
   * @returns {Viewer} Viewer实例
   */
  create(container) {
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
      creditContainer: document.createElement('div'),
      // 禁用 requestRenderMode，让场景在可见时持续渲染以支持拖拽交互
      // 仅在 unmount 时启用 requestRenderMode 暂停渲染降低 GPU 占用
      requestRenderMode: false,
      maximumRenderTimeChange: Infinity,
    })

    this.isMounted = true
    return this.viewer
  }

  /**
   * 挂载到指定DOM容器
   *
   * 无论viewer是否已在正确容器中，都确保：
   * 1. isMounted 标记为 true
   * 2. viewer 尺寸正确更新
   * 3. requestRenderMode 设置为 false（持续渲染以支持交互）
   * 4. 相机控制器交互能力正常启用
   *
   * @param {HTMLElement} el - 目标DOM容器
   * @returns {boolean} 是否挂载成功
   */
  mount(el) {
    if (!this.viewer) {
      return false
    }

    if (!el) {
      return false
    }

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
    // 恢复持续渲染模式（关闭requestRenderMode让每帧都渲染，支持拖拽交互）
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
    }
  }

  /**
   * 获取单例
   * @returns {Viewer|null}
   */
  getInstance() {
    return this.viewer
  }

  /**
   * 检查底图是否已初始化
   * @returns {boolean}
   */
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
    }

    // 每次都需要重新绑定事件（因为事件处理器绑定到当前Renderer实例）
    this._setupClickHandler()

    // 关键修复：无论Viewer是首次创建还是复用，都必须调用_setupZoomLimits()
    // 确保相机控制器的交互能力（拖拽、旋转、缩放等）被正确启用
    // 如果只在首次创建时调用，复用时可能因为之前的状态导致交互失效
    this._setupZoomLimits()
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
   * 重写destroy方法：3D→2D切换时卸载DOM，但不销毁Viewer实例
   * 这样再次进入3D路由时可以复用Viewer，保留状态
   */
  destroy() {
    // 卸载DOM（不销毁Viewer）
    cesiumViewerManager.unmount()
    // 清理当前Renderer的图层和事件
    super.destroy()
  }

  _positionCamera() {
    this.viewer.scene.globe.enableLighting = true
    const { center, heading, pitch, roll } = MAP_CONFIG.CAMERA
    const destination = Cartesian3.fromDegrees(center.lng, center.lat, center.height)
    this.viewer.camera.flyTo({
      destination,
      orientation: {
        heading: CesiumMath.toRadians(heading),
        pitch: CesiumMath.toRadians(pitch),
        roll,
      },
    })
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
          this.emit('click', {
            featureType,
            data: properties,
            coordinate,
          })
          return
        }
      }
      this.emit('click', {
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
    const entities = []

    features.forEach((item) => {
      const entity = this.viewer.entities.add({
        id: `${id}-${item.id || item.name}`,
        position: Cartesian3.fromDegrees(item.lon, item.lat),
        point: {
          pixelSize: options.size || 12,
          color: Color.fromCssColorString(options.color || '#409eff'),
          outlineColor: Color.WHITE,
          outlineWidth: 2,
        },
        label: options.labelField
          ? {
              text: item[options.labelField],
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
              material: Color.fromCssColorString(options.fillColor || 'rgba(77,171,247,0.15)'),
              outline: true,
              outlineColor: Color.fromCssColorString(options.strokeColor || '#4dabf7'),
              outlineWidth: options.strokeWidth || 2,
            },
            properties: { ...item, featureType: options.featureType || 'polygon' },
          })
          entities.push(entity)
        } catch (e) {
          if (import.meta.env.DEV) {
            console.warn('创建多边形实体失败:', e)
          }
        }
      }
      if (geometryType === 'MultiPolygon') {
        coordinates.forEach((polyCoords) => createPolygon(polyCoords))
      } else {
        const coords = geometryType === 'Polygon' ? coordinates : coordinates[0]
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
    try {
      const dataSource = await GeoJsonDataSource.load(geojson)

      dataSource.entities.values.forEach((entity) => {
        entity.properties.featureType = options.featureType || 'geojson'
        if (entity.polygon) {
          entity.polygon.material = Color.fromCssColorString(
            options.fillColor || 'rgba(77,171,247,0.15)',
          )
          entity.polygon.outline = true
          entity.polygon.outlineColor = Color.fromCssColorString(options.strokeColor || '#4dabf7')
          entity.polygon.outlineWidth = options.strokeWidth || 2
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
      options.onError?.('GeoJSON数据加载失败')
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
    const destination = Cartesian3.fromDegrees(target.lng, target.lat, height)
    this.viewer.camera.flyTo({
      destination,
      duration: 1000,
      orientation: {
        heading: CesiumMath.toRadians(options.heading || 0),
        pitch: CesiumMath.toRadians(options.pitch || -60),
        roll: 0,
      },
    })
  }

  _getCameraState() {
    const position = this.viewer.camera.positionCartographic
    return {
      center: {
        lng: CesiumMath.toDegrees(position.longitude),
        lat: CesiumMath.toDegrees(position.latitude),
      },
      height: position.height,
      heading: CesiumMath.toDegrees(this.viewer.camera.heading),
      pitch: CesiumMath.toDegrees(this.viewer.camera.pitch),
    }
  }

  _setCameraState(state) {
    const destination = Cartesian3.fromDegrees(
      state.center.lng,
      state.center.lat,
      state.height || MAP_CONFIG.CAMERA.height,
    )
    this.viewer.camera.flyTo({
      destination,
      orientation: {
        heading: CesiumMath.toRadians(state.heading || 0),
        pitch: CesiumMath.toRadians(state.pitch || -90),
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

  getType() {
    return 'cesium'
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
    super.destroy()
    this.stopBreathing()
    // 不销毁Viewer，只从DOM卸载
    cesiumViewerManager.unmount()
    this.viewer = null
  }
}

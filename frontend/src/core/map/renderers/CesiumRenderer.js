import {
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ColorGeometryInstanceAttribute,
  GeoJsonDataSource,
  GeometryInstance,
  Math as CesiumMath,
  PerInstanceColorAppearance,
  PointGraphics,
  PolygonGeometry,
  PolygonHierarchy,
  Primitive,
  ScreenSpaceEventType,
  UrlTemplateImageryProvider,
  Viewer,
} from 'cesium'

import { buildTiandituUrl, MAP_CONFIG, zoomToHeight } from '@/core/config/map'
import { LAYER_DEFAULTS } from '@/shared/constants/colors'
import { logger } from '@/shared/utils/logger'

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
   *
   * 监听相机移动事件，300ms防抖后才触发渲染和状态同步。
   * 避免拖拽/缩放过程中频繁更新，降低CPU/GPU负载。
   */
  _setupCameraDebounce() {
    const DEBOUNCE_DELAY = 300
    // 保存监听器引用，供 destroy 移除，防止泄漏与 TypeError
    this._cameraChangedHandler = () => {
      // 清除之前的防抖定时器
      if (this._cameraDebounceTimer) {
        clearTimeout(this._cameraDebounceTimer)
      }
      this._cameraDebounceTimer = setTimeout(() => {
        // viewer 可能已置空，防御
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
      })
    )
    const imageAnnotationLayer = this.viewer.imageryLayers.addImageryProvider(
      new UrlTemplateImageryProvider({
        url: buildTiandituUrl(MAP_CONFIG.BASE_LAYERS.image.layers[1]),
        maximumLevel: 18,
      })
    )
    const vectorBaseProvider = this.viewer.imageryLayers.addImageryProvider(
      new UrlTemplateImageryProvider({
        url: buildTiandituUrl(MAP_CONFIG.BASE_LAYERS.vector.layers[0]),
        maximumLevel: 18,
      })
    )
    const vectorAnnotationProvider = this.viewer.imageryLayers.addImageryProvider(
      new UrlTemplateImageryProvider({
        url: buildTiandituUrl(MAP_CONFIG.BASE_LAYERS.vector.layers[1]),
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
    this._screenSpaceEventHandler = this.viewer.screenSpaceEventHandler
    this._screenSpaceEventHandler.setInputAction((click) => {
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
    // 幂等：先清除同 id 旧图层，防止 Entity 累积 + 相机监听器泄漏
    const existing = this._layers.get(id)
    if (existing) this._doRemoveLayer(existing)

    // P0性能优化：Entity数量控制 + 视口裁剪（>1000 时仅渲染视口内要素）
    const totalEntities = this.viewer.entities.values.length + features.length
    if (totalEntities > 1000 && import.meta.env.DEV) {
      console.warn(`[CesiumRenderer] Entity数量(${totalEntities})超过1000，启动视口裁剪`)
    }

    // 视口裁剪：仅添加当前视口内的点
    const bbox = this._getViewportBBox()

    const entities = []
    features.forEach((item, index) => {
      // 防御性编程：优先使用 lng，兼容可能的 lon 字段
      const lng = item.lng ?? item.lon ?? 0
      if (bbox && !this._isInViewport(lng, item.lat, bbox)) return
      const entity = this._createCesiumPointEntity(id, item, index, options)
      if (entity) entities.push(entity)
    })

    if (entities.length === 0 && import.meta.env.DEV) {
      console.warn(`[CesiumRenderer] 图层 ${id} 视口内无可见要素（总 ${features.length} 个）`)
    }

    this._layers.set(id, {
      instance: entities,
      visible: true,
      options,
      // 保存原始 features 供视口变化时增量更新
      allFeatures: features,
    })
    this._applyPendingVisibility(id)
    // 触发渲染
    this.viewer.scene.requestRender()

    // 注册相机变化监听，视口变化时增量更新
    this._setupViewportListener(id)
  }

  /**
   * 创建并添加一个 Cesium 点 Entity（含 label / properties）
   * 供 addPointLayer 与 _updateCulledLayer 复用，保证实体构建逻辑单一来源。
   * @returns {object|null}
   */
  _createCesiumPointEntity(id, item, index, options) {
    const lng = item.lng ?? item.lon ?? 0
    return this.viewer.entities.add({
      id: `${id}-${item.id || item.name || index}`,
      position: Cartesian3.fromDegrees(lng, item.lat),
      point: {
        pixelSize: options.size || 12,
        color: Color.fromCssColorString(options.color || LAYER_DEFAULTS.color),
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
  }

  /**
   * 计算当前相机视口的经纬度范围（简化估算）
   *
   * ⚠️ 注意：Cesium `camera.positionCartographic` 的 longitude/latitude 单位为**弧度**，
   * 必须用 CesiumMath.toDegrees 转换为角度后再与要素经纬度比较。
   *
   * @returns {{west:number, east:number, south:number, north:number} | null}
   */
  _getViewportBBox() {
    if (!this.viewer) return null
    const camera = this.viewer.camera
    const cartographic = camera.positionCartographic
    if (!cartographic) return null
    // 根据相机高度估算视口范围（简化版）
    // 高度越高，视口范围越大
    const height = cartographic.height
    if (height > 5000000) return null // 太高不做裁剪
    // 粗略估算：1 度 ≈ 111km，视口半宽 ≈ height / 2 / 111000 * 1.5（余量）
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
   */
  _isInViewport(lng, lat, bbox) {
    if (!bbox) return true // 无视口信息时不裁剪
    return lng >= bbox.west && lng <= bbox.east && lat >= bbox.south && lat <= bbox.north
  }

  /**
   * 为点图层注册视口变化监听
   * 相机移动时，增量添加/移除视口内外的要素（requestAnimationFrame 防抖）
   */
  _setupViewportListener(id) {
    const layer = this._layers.get(id)
    if (!layer || !layer.allFeatures) return

    // 防抖：相机移动时频繁触发，用 requestAnimationFrame 合并
    let rafId = null
    const updateHandler = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        this._updateCulledLayer(id)
        rafId = null
      })
    }

    // 移除旧监听（如果存在）
    if (layer.cameraListener) {
      this.viewer.camera.changed.removeEventListener(layer.cameraListener)
    }

    this.viewer.camera.changed.addEventListener(updateHandler)
    layer.cameraListener = updateHandler
  }

  /**
   * 视口变化时增量更新裁剪图层：移除离开视口的 Entity，添加新进入视口的 Entity
   */
  _updateCulledLayer(id) {
    const layer = this._layers.get(id)
    if (!layer || !layer.allFeatures || !layer.visible) return

    const bbox = this._getViewportBBox()
    if (!bbox) return

    // 计算应显示的要素 ID 集合（ID 与 _createCesiumPointEntity 保持一致：id-index）
    const shouldShow = new Set()
    layer.allFeatures.forEach((item, index) => {
      const lng = item.lng ?? item.lon ?? 0
      if (this._isInViewport(lng, item.lat, bbox)) {
        shouldShow.add(`${id}-${item.id || item.name || index}`)
      }
    })

    // 移除不在视口内的 Entity
    for (const entity of layer.instance) {
      if (!shouldShow.has(entity.id)) {
        this.viewer.entities.remove(entity)
      }
    }

    // 添加新进入视口的 Entity
    const existingIds = new Set(layer.instance.map((e) => e.id))
    layer.allFeatures.forEach((item, index) => {
      const entityId = `${id}-${item.id || item.name || index}`
      if (shouldShow.has(entityId) && !existingIds.has(entityId)) {
        const entity = this._createCesiumPointEntity(id, item, index, layer.options)
        if (entity) layer.instance.push(entity)
      }
    })

    // 清理已移除的 Entity 引用
    layer.instance = layer.instance.filter((e) => this.viewer.entities.contains(e))
  }

  addPolygonLayer(id, features, options = {}) {
    // 幂等：先清除同 id 旧图层，防止 Entity 累积
    const existing = this._layers.get(id)
    if (existing) this._doRemoveLayer(existing)

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
              material: Color.fromCssColorString(options.fillColor || LAYER_DEFAULTS.fill),
              outline: true,
              outlineColor: Color.fromCssColorString(options.strokeColor || LAYER_DEFAULTS.stroke),
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
    // 幂等：先清除同 id 旧图层，防止 dataSource 累积
    const existing = this._layers.get(id)
    if (existing) this._doRemoveLayer(existing)

    // 异步竞态保护：用 token 标记当前请求，await 后检查是否仍为最新
    this._geoJsonTokens = this._geoJsonTokens || new Map()
    const token = Symbol(id)
    this._geoJsonTokens.set(id, token)

    try {
      const dataSource = await GeoJsonDataSource.load(geojson)

      // await 后检查：若有更新的同 id 请求，丢弃本次结果
      if (this._geoJsonTokens.get(id) !== token) return

      logger.debug(`[CesiumRenderer] GeoJSON ${id} entities:`, dataSource.entities.values.length)
      dataSource.entities.values.forEach((entity) => {
        // @arch-note SEC-018: properties 可能为 undefined（无属性的 GeoJSON 要素），判空避免崩溃
        if (!entity.properties) entity.properties = {}
        entity.properties.featureType = options.featureType || 'geojson'
        if (entity.polygon) {
          entity.polygon.height = 0.5
          entity.polygon.material = Color.fromCssColorString(
            options.fillColor || LAYER_DEFAULTS.fill
          )
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
          })
        }
      })
      this.viewer.dataSources.add(dataSource)

      // 再次检查 token，防止 await 期间被新请求覆盖
      if (this._geoJsonTokens.get(id) !== token) {
        this.viewer.dataSources.remove(dataSource, true)
        return
      }

      this._layers.set(id, {
        instance: dataSource,
        visible: true,
        options,
      })
      this._applyPendingVisibility(id)
      this.viewer.scene.requestRender()
    } catch (error) {
      if (this._geoJsonTokens.get(id) === token) {
        this._geoJsonTokens.delete(id)
      }
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
    // 移除视口监听（视口裁剪点图层特有，其它图层为 undefined）
    if (layer.cameraListener) {
      this.viewer.camera.changed.removeEventListener(layer.cameraListener)
      layer.cameraListener = null
    }
    if (layer.instance) {
      if (Array.isArray(layer.instance)) {
        layer.instance.forEach((entity) => {
          if (entity) this.viewer.entities.remove(entity)
        })
      } else {
        // 第二参数 destroy=true 让 Cesium 在移除时销毁 dataSource，防止内存泄漏
        this.viewer.dataSources.remove(layer.instance, true)
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
    // 限制height范围：最低200m（避免贴地），最高1000000m（避免视角太高）
    height = Math.max(200, Math.min(height, 1000000))

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

  // 使用Primitive API而非Entity，适合大规模几何体
  addWaterSurface(id, coordinates, height = 0, options = {}) {
    this.removeWaterSurface(id)
    try {
      const positions = coordinates.map((coord) =>
        Cartesian3.fromDegrees(coord[0], coord[1], height)
      )
      const hierarchy = new PolygonHierarchy(positions)
      const geometry = new PolygonGeometry({
        polygonHierarchy: hierarchy,
        vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
      })

      const instance = new GeometryInstance({
        geometry: geometry,
        attributes: {
          color: ColorGeometryInstanceAttribute.fromColor(
            // 水面色复用 LAYER_DEFAULTS.color（#409eff），保留 0.5 透明度以维持水面半透明观感
            Color.fromCssColorString(options.color || LAYER_DEFAULTS.color).withAlpha(0.5)
          ),
        },
        id: `water-${id}`,
      })

      const appearance = new PerInstanceColorAppearance({
        translucent: true,
        closed: false,
      })

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
    } catch (e) {
      // 坐标无效或几何体构建失败时不中断调用方
      if (import.meta.env.DEV) {
        console.warn(`[CesiumRenderer] 水面图层 ${id} 创建失败:`, e)
      }
    }
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
    // 移除相机监听器
    if (this.viewer && this._cameraChangedHandler) {
      this.viewer.camera.changed.removeEventListener(this._cameraChangedHandler)
      this._cameraChangedHandler = null
    }

    // 清理屏幕事件处理器，防止内存泄漏
    if (this._screenSpaceEventHandler) {
      this._screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_CLICK)
      this._screenSpaceEventHandler = null
    }

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
}

import { MapRenderer } from './MapRenderer'
import Map from 'ol/Map'
import View from 'ol/View'
import { fromLonLat, toLonLat } from 'ol/proj'
import VectorSource from 'ol/source/Vector'
import VectorLayer from 'ol/layer/Vector'
import TileLayer from 'ol/layer/Tile'
import XYZ from 'ol/source/XYZ'
import Point from 'ol/geom/Point'
import Polygon from 'ol/geom/Polygon'
import Feature from 'ol/Feature'
import GeoJSON from 'ol/format/GeoJSON'
import { Style, Fill, Stroke, Circle, Text } from 'ol/style'
import Heatmap from 'ol/layer/Heatmap'
import { buildTiandituUrl, MAP_CONFIG, heightToZoom } from '@/core/config/map'
import { logger } from '@/shared/utils/logger'
import { normalizePoint } from '@/types/crs'
import { createSpatialIndex, VIEWPORT_CULL_THRESHOLD } from '@/shared/utils/spatialIndex'
import { LAYER_DEFAULTS } from '@/shared/constants/colors'

export class OLRenderer extends MapRenderer {
  constructor(container) {
    super(container)
    this.map = null
    this.baseLayers = { image: [], vector: [] }
    // 视口裁剪：大数量点图层（>阈值）的 R-tree 索引 + moveend 监听
    this._cullLayers = new Map() // id -> { source, index, allFeatures, options }
    this._moveendKey = null
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
          crossOrigin: 'anonymous',
        }),
      })
      layer.set('isBaseMap', true)
      layer.set('baseType', 'image')
      return layer
    })
    const vectorLayers = MAP_CONFIG.BASE_LAYERS.vector.layers.map((code) => {
      const layer = new TileLayer({
        source: new XYZ({
          url: buildTiandituUrl(code),
          crossOrigin: 'anonymous',
        }),
      })
      layer.set('isBaseMap', true)
      layer.set('baseType', 'vector')
      layer.setVisible(false)
      return layer
    })
    this.baseLayers.image = imageLayers
    this.baseLayers.vector = vectorLayers

    imageLayers.forEach((l) => this.map.addLayer(l))
    vectorLayers.forEach((l) => this.map.addLayer(l))
  }
  _setupClickHandler() {
    this.map.on('click', (event) => {
      const coordinate = toLonLat(event.coordinate)
      let clickedFeature = false

      this.map.forEachFeatureAtPixel(
        event.pixel,
        (feature) => {
          const featureType = feature.get('featureType')
          if (featureType) {
            const properties = feature.getProperties()
            this.emit('click', {
              featureType,
              data: properties,
              coordinate,
            })
            clickedFeature = true
            return true
          }
        },
        {
          layerFilter: (layer) => !layer.get('isBaseMap'),
        }
      )
      if (!clickedFeature) {
        this.emit('click', {
          featureType: null,
          data: null,
          coordinate,
        })
      }
    })
  }

  addPointLayer(id, features, options = {}) {
    const style = this._createPointStyle(options)

    // 大数量点图层启用视口裁剪：R-tree 索引 + moveend 增量更新
    if (features.length > VIEWPORT_CULL_THRESHOLD) {
      this._addCulledPointLayer(id, features, options, style)
      return
    }

    const olFeatures = features.map((item) => {
      // 数据入口归一化：统一 lng/lon/longitude 字段名为标准 GeoPoint
      const { lng, lat } = normalizePoint(item)
      const feature = new Feature({
        geometry: new Point(fromLonLat([lng, lat])),
      })
      const featureType = options?.featureType || item?.featureType || 'point'
      feature.setProperties({ ...item, featureType })
      return feature
    })

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

  /**
   * 大数量点图层的视口裁剪加载
   * 构建 R-tree 索引（EPSG:3857），初始只渲染视口内要素，moveend 时增量更新
   */
  _addCulledPointLayer(id, features, options, style) {
    const featureType = options?.featureType || 'point'
    // 构建 R-tree 索引项：[minX, minY, maxX, maxY] + 原始数据
    const index = createSpatialIndex()
    const indexItems = features.map((item) => {
      const { lng, lat } = normalizePoint(item)
      const coord = fromLonLat([lng, lat])
      return { minX: coord[0], minY: coord[1], maxX: coord[0], maxY: coord[1], data: item }
    })
    index.load(indexItems)

    const source = new VectorSource()
    const vectorLayer = new VectorLayer({ source, style })
    this.map.addLayer(vectorLayer)
    this._layers.set(id, { instance: vectorLayer, visible: true, options })
    this._applyPendingVisibility(id)

    this._cullLayers.set(id, { source, index, options, featureType })
    this._ensureMoveendListener()

    // 初始加载视口内要素
    this._refreshCulledLayer(id)

    if (import.meta.env.DEV) {
      logger.info(`[OLRenderer] 图层 ${id} 启用视口裁剪，共 ${features.length} 个要素`)
    }
  }

  /** 确保 moveend 监听只注册一次 */
  _ensureMoveendListener() {
    if (this._moveendKey) return
    this._moveendKey = this.map.on('moveend', () => {
      for (const id of this._cullLayers.keys()) {
        this._refreshCulledLayer(id)
      }
    })
  }

  /** 刷新单个裁剪图层：查询当前视口内要素并替换 source */
  _refreshCulledLayer(id) {
    const entry = this._cullLayers.get(id)
    if (!entry) return

    const extent = this.map.getView().calculateExtent(this.map.getSize())
    const visible = entry.index.query(extent)

    const olFeatures = visible.map((item) => {
      const { lng, lat } = normalizePoint(item.data)
      const feature = new Feature({ geometry: new Point(fromLonLat([lng, lat])) })
      feature.setProperties({ ...item.data, featureType: entry.featureType })
      return feature
    })

    entry.source.clear()
    entry.source.addFeatures(olFeatures)
  }
  _createPointStyle(options) {
    if (!options.labelField) {
      return new Style({
        image: new Circle({
          radius: options.size || 12,
          fill: new Fill({ color: options.color || LAYER_DEFAULTS.color }),
          stroke: new Stroke({ color: LAYER_DEFAULTS.outline, width: 2 }),
        }),
      })
    }
    return (feature) =>
      new Style({
        image: new Circle({
          radius: options.size || 12,
          fill: new Fill({ color: options.color || LAYER_DEFAULTS.color }),
          stroke: new Stroke({ color: LAYER_DEFAULTS.outline, width: 2 }),
        }),
        text: new Text({
          text: feature.get(options.labelField),
          font: '12px sans-serif',
          fill: new Fill({ color: LAYER_DEFAULTS.text }),
          stroke: new Stroke({ color: LAYER_DEFAULTS.outline, width: 2 }),
          offsetY: 15,
        }),
      })
  }
  addPolygonLayer(id, features, options = {}) {
    // 辅助函数 - 确保坐标环闭合
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

        // 验证坐标数组有效性
        if (!Array.isArray(coordinates) || coordinates.length === 0) return null

        let polygonCoords
        if (item.geometry?.type === 'MultiPolygon') {
          // 验证MultiPolygon坐标结构
          if (!Array.isArray(coordinates[0]) || !Array.isArray(coordinates[0][0])) return null
          // 验证并闭合每个多边形的坐标环
          polygonCoords = coordinates
            .map((poly) => {
              const closedRing = ensureRingClosed(poly[0])
              return closedRing ? closedRing.map(([lng, lat]) => fromLonLat([lng, lat])) : null
            })
            .filter((coords) => coords !== null)
          if (polygonCoords.length === 0) return null
        } else {
          // 验证Polygon坐标结构
          if (!Array.isArray(coordinates[0]) || !Array.isArray(coordinates[0][0])) return null
          // 验证并闭合坐标环
          const closedRing = ensureRingClosed(coordinates[0])
          if (!closedRing) return null
          polygonCoords = [closedRing.map(([lng, lat]) => fromLonLat([lng, lat]))]
        }
        const feature = new Feature({
          geometry: new Polygon(polygonCoords),
        })
        feature.setProperties({ ...item, featureType: options.featureType || 'polygon' })
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
      fill: new Fill({ color: options.fillColor || 'rgba(77,171,247,0.15)' }),
      stroke: new Stroke({
        color: options.strokeColor || LAYER_DEFAULTS.stroke,
        width: options.strokeWidth || 2,
      }),
    })
  }
  addGeoJsonLayer(id, geojson, options = {}) {
    const features = new GeoJSON().readFeatures(geojson, {
      featureProjection: 'EPSG:3857',
    })
    features.forEach((feature) => {
      feature.set('featureType', options.featureType || 'geojson')
    })
    // 按几何类型分派样式，点要素支持 markerColor/markerSize
    const polygonStyle = this._createPolygonStyle(options)
    const pointStyle = new Style({
      image: new Circle({
        radius: (options.markerSize || 10) / 2,
        fill: new Fill({ color: options.markerColor || LAYER_DEFAULTS.marker }),
        stroke: new Stroke({ color: LAYER_DEFAULTS.outline, width: 2 }),
      }),
    })
    // TODO: 支持 options.style 回调，用于 per-feature 样式
    const defaultStyle = (feature) => {
      const geom = feature.getGeometry()
      return geom.getType() === 'Point' ? pointStyle : polygonStyle
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

  // 原设计文档使用 addGeoJsonLayer({type:'heatmap'})，但现有接口不支持
  // 正确做法：独立方法 + 参考 OpenLayers Heatmap 官方示例
  addHeatmapLayer(id, features, options = {}) {
    const {
      weightField = 'value',
      radius = 20,
      blur = 15,
      gradient = LAYER_DEFAULTS.heatmapGradient,
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

    layer.set('id', id)
    this.map.addLayer(layer)
    this._layers.set(id, {
      instance: layer,
      visible: true,
      options,
    })
    this._applyPendingVisibility(id)

    return true
  }

  updateHeatmapLayer(id, features, options = {}) {
    const entry = this._layers.get(id)
    if (!entry) return false

    const source = entry.instance.getSource()
    if (!source) return false

    const { weightField: _weightField = 'value' } = options

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
        if (source && source.dispose) {
          source.dispose()
        }
      }
    }
  }

  /** 移除视口裁剪图层时清理索引和监听 */
  _removeCullLayer(id) {
    this._cullLayers.delete(id)
    if (this._cullLayers.size === 0 && this._moveendKey) {
      this.map.un(this._moveendKey.type, this._moveendKey.listener)
      this._moveendKey = null
    }
  }
  _doFlyTo(target, options = {}) {
    const view = this.map.getView()
    if (target.layerId) {
      const layer = this._layers.get(target.layerId)
      if (layer && layer.instance) {
        // 验证 source 和 getExtent 方法存在性
        const source = layer.instance.getSource()
        if (source && typeof source.getExtent === 'function') {
          const extent = source.getExtent()
          if (extent) {
            view.fit(extent, { duration: 1000 })
            return
          }
        }
      }
    }
    // 数据入口归一化：统一 lng/lon/longitude 字段名
    const { lng, lat } = normalizePoint(target)
    view.animate({
      center: fromLonLat([lng, lat]),
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

    logger.debug('[OLRenderer._getCameraState] 导出状态:', state)

    return state
  }
  _setCameraState(state) {
    logger.debug('[OLRenderer._setCameraState] 导入原始状态:', state)

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
    this.baseLayers.image.forEach((l) => l.setVisible(type === 'image'))
    this.baseLayers.vector.forEach((l) => l.setVisible(type === 'vector'))
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
          stroke: new Stroke({ color: LAYER_DEFAULTS.outline, width: 2 }),
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
    return 'ol'
  }
  getMap() {
    return this.map
  }
  updateSize() {
    this.map?.updateSize()
  }
  addWaterSurface(_id, _coordinates, _height, _options) {
    if (import.meta.env.DEV) {
      console.warn('[OLRenderer] addWaterSurface 不支持 2D 渲染器')
    }
    return false
  }

  updateWaterLevel(_id, _newHeight) {
    if (import.meta.env.DEV) {
      console.warn('[OLRenderer] updateWaterLevel 不支持 2D 渲染器')
    }
    return false
  }

  removeWaterSurface(_id) {
    if (import.meta.env.DEV) {
      console.warn('[OLRenderer] removeWaterSurface 不支持 2D 渲染器')
    }
    return false
  }

  removeAllWaterSurfaces() {
    if (import.meta.env.DEV) {
      console.warn('[OLRenderer] removeAllWaterSurfaces 不支持 2D 渲染器')
    }
    return false
  }

  setWaterSurfaceVisibility(_id, _visible) {
    if (import.meta.env.DEV) {
      console.warn('[OLRenderer] setWaterSurfaceVisibility 不支持 2D 渲染器')
    }
    return false
  }

  destroy() {
    super.destroy()
    this.stopBreathing()
    // 清理视口裁剪图层
    this._cullLayers.clear()
    if (this._moveendKey) {
      this.map?.un(this._moveendKey.type, this._moveendKey.listener)
      this._moveendKey = null
    }
    this.map?.dispose()
    this.map = null
  }
}

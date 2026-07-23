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
import { buildTiandituUrl, MAP_CONFIG, heightToZoom } from '@/core/config/map'

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
      minZoom: 9,
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
        },
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
    const olFeatures = features.map((item) => {
      const feature = new Feature({
        geometry: new Point(fromLonLat([item.lon, item.lat])),
      })
      const featureType = options?.featureType || item?.featureType || 'point'
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
          fill: new Fill({ color: options.color || '#409eff' }),
          stroke: new Stroke({ color: '#fff', width: 2 }),
        }),
      })
    }
    return (feature) =>
      new Style({
        image: new Circle({
          radius: options.size || 12,
          fill: new Fill({ color: options.color || '#409eff' }),
          stroke: new Stroke({ color: '#fff', width: 2 }),
        }),
        text: new Text({
          text: feature.get(options.labelField),
          font: '12px sans-serif',
          fill: new Fill({ color: '#000' }),
          stroke: new Stroke({ color: '#fff', width: 2 }),
          offsetY: 15,
        }),
      })
  }
  addPolygonLayer(id, features, options = {}) {
    // AUDIT-GIS-008: 辅助函数 - 确保坐标环闭合
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

        // AUDIT-010: 验证坐标数组有效性
        if (!Array.isArray(coordinates) || coordinates.length === 0) return null

        let polygonCoords
        if (item.geometry?.type === 'MultiPolygon') {
          // AUDIT-010: 验证MultiPolygon坐标结构
          if (!Array.isArray(coordinates[0]) || !Array.isArray(coordinates[0][0])) return null
          // AUDIT-GIS-008: 验证并闭合每个多边形的坐标环
          polygonCoords = coordinates
            .map((poly) => {
              const closedRing = ensureRingClosed(poly[0])
              return closedRing ? closedRing.map(([lng, lat]) => fromLonLat([lng, lat])) : null
            })
            .filter((coords) => coords !== null)
          if (polygonCoords.length === 0) return null
        } else {
          // AUDIT-010: 验证Polygon坐标结构
          if (!Array.isArray(coordinates[0]) || !Array.isArray(coordinates[0][0])) return null
          // AUDIT-GIS-008: 验证并闭合坐标环
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
        color: options.strokeColor || '#4dabf7',
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
    // BUGFIX-P1-11: 按几何类型分派样式，点要素支持 markerColor/markerSize
    const polygonStyle = this._createPolygonStyle(options)
    const pointStyle = new Style({
      image: new Circle({
        radius: (options.markerSize || 10) / 2,
        fill: new Fill({ color: options.markerColor || '#409eff' }),
        stroke: new Stroke({ color: '#fff', width: 2 }),
      }),
    })
    const vectorLayer = new VectorLayer({
      source: new VectorSource({ features }),
      style: (feature) => {
        const geom = feature.getGeometry()
        return geom.getType() === 'Point' ? pointStyle : polygonStyle
      },
    })
    this.map.addLayer(vectorLayer)
    this._layers.set(id, {
      instance: vectorLayer,
      visible: true,
      options,
    })
    this._applyPendingVisibility(id)
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
        // AUDIT-GIS-010: 调用 dispose() 释放资源
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
        // AUDIT-016: 验证 source 和 getExtent 方法存在性
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
    // BUGFIX-P3-01: 兼容数据源 lon 字段（ports.json）和接口 lng 字段
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

    // 调试日志：输出OL相机状态
    if (import.meta.env.DEV) {
      console.log('[OLRenderer._getCameraState] 导出状态:', state)
    }

    return state
  }
  _setCameraState(state) {
    // 调试日志：输出导入的原始状态
    if (import.meta.env.DEV) {
      console.log('[OLRenderer._setCameraState] 导入原始状态:', state)
    }

    const view = this.map.getView()
    view.setCenter(fromLonLat([state.center.lng, state.center.lat]))

    // 从 Cesium 的 height 反算 OL zoom
    if (state.height != null) {
      const zoom = heightToZoom(state.height)
      const clampedZoom = Math.min(Math.max(zoom, 9), 18)
      view.setZoom(clampedZoom)
    } else if (state.zoom != null) {
      view.setZoom(state.zoom)
    }
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
          stroke: new Stroke({ color: '#fff', width: 2 }),
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
    this.map?.dispose()
    this.map = null
  }
}

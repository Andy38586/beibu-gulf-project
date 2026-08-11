// OpenLayers 2D 渲染器：视图为 Web 墨卡托投影（EPSG:3857），业务坐标用 WGS84 经纬度（EPSG:4326）。
import type { FeatureCollection } from 'geojson'
import type { EventsKey } from 'ol/events'
import type { FeatureLike } from 'ol/Feature'
import Feature from 'ol/Feature'
import GeoJSON from 'ol/format/GeoJSON'
import Point from 'ol/geom/Point'
import Polygon from 'ol/geom/Polygon'
import type BaseLayer from 'ol/layer/Base'
import Heatmap from 'ol/layer/Heatmap'
import TileLayer from 'ol/layer/Tile'
import VectorLayer from 'ol/layer/Vector'
// 不能 import { Map }：会遮蔽全局 ES Map，new Map()（如 _cullLayers 初始化）会误建 ol/Map 实例
import OlMap from 'ol/Map'
import type MapBrowserEvent from 'ol/MapBrowserEvent'
import { fromLonLat, toLonLat } from 'ol/proj'
import GeoTIFF from 'ol/source/GeoTIFF'
import VectorSource from 'ol/source/Vector'
import XYZ from 'ol/source/XYZ'
import { Circle, Fill, Stroke, Style, Text } from 'ol/style'
import type { StyleFunction } from 'ol/style/Style'
import View from 'ol/View'

import { buildTiandituUrl, heightToZoom, MAP_CONFIG } from '@/core/config/map'
import { LAYER_DEFAULTS } from '@/shared'
import { logger } from '@/shared'
import { createSpatialIndex, VIEWPORT_CULL_THRESHOLD } from '@/shared'
import { normalizePoint } from '@/shared'
import type { LayerOptions, PointFeature, PolygonFeature } from '@/types'
import type { CameraState, FlyToOptions, FlyToTarget } from '@/types'

import { MapRenderer } from './MapRenderer'

/** Web 墨卡托投影标识（View/GeoJSON 读取共用，避免字面量散落——W4-04） */
const WEB_MERCATOR = 'EPSG:3857'

/** 视口裁剪图层条目（_cullLayers 值类型） */
interface CullLayerEntry {
  source: VectorSource
  index: ReturnType<typeof createSpatialIndex<PointFeature>>
  options: LayerOptions
  featureType: string
}

/** OpenLayers 2D 渲染器（实现 MapRenderer 抽象能力） */
export class OLRenderer extends MapRenderer {
  map: OlMap | null
  baseLayers: { image: TileLayer<XYZ>[]; vector: TileLayer<XYZ>[] }
  _cullLayers: Map<string, CullLayerEntry>
  _moveendKey: EventsKey | null
  // OL on() 的 listener 参数为宽类型（Event），业务回调按需收窄
  _pointerMoveHandler: ((evt: unknown) => void) | null
  _cameraChangedKey: EventsKey | null
  _cameraDebounceTimer: ReturnType<typeof setTimeout> | null
  _clickKey: EventsKey | null
  _clickHandler: ((evt: unknown) => void) | null
  _breathingLayer: VectorLayer<VectorSource> | null
  _breathingAnimId: number | null

  constructor(container: HTMLElement) {
    super(container)
    this.map = null
    this.baseLayers = { image: [], vector: [] }
    // 视口裁剪：大数量点图层（>阈值）的 R-tree 索引 + moveend 监听
    this._cullLayers = new Map() // id -> { source, index, allFeatures, options }
    this._moveendKey = null
    // pointer-move / camera-changed / click 事件处理器与防抖定时器引用（供 destroy 注销）
    this._pointerMoveHandler = null
    this._cameraChangedKey = null
    this._cameraDebounceTimer = null
    this._clickKey = null
    this._clickHandler = null
    this._breathingLayer = null
    this._breathingAnimId = null
    this._initMap()
  }
  _initMap(): void {
    const view = new View({
      // 显式声明投影：业务坐标为 WGS84，地图渲染统一 Web 墨卡托（W4-05）
      projection: WEB_MERCATOR,
      center: fromLonLat([MAP_CONFIG.CAMERA.center.lng, MAP_CONFIG.CAMERA.center.lat]),
      zoom: 9,
      minZoom: 6,
      maxZoom: 20,
    })
    this.map = new OlMap({
      target: this.container,
      view,
      layers: [],
    })
    this._initBaseLayers()
    this._setupClickHandler()
    this._setupPointerHandlers()
  }
  _initBaseLayers(): void {
    const map = this.map
    if (!map) return
    const imageLayers = MAP_CONFIG.BASE_LAYERS.image.layers.map((code: string) => {
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

    imageLayers.forEach((l) => {
      l.setZIndex(LAYER_DEFAULTS.zIndexBase)
      map.addLayer(l)
    })
    vectorLayers.forEach((l) => {
      l.setZIndex(LAYER_DEFAULTS.zIndexBase)
      map.addLayer(l)
    })
  }
  _setupClickHandler(): void {
    const map = this.map
    if (!map) return
    // 具名处理器 + key 保存（W4-21）：destroy 时能注销，匿名回调无引用可解绑
    this._clickHandler = (event: unknown) => {
      const evt = event as MapBrowserEvent<PointerEvent>
      const coordinate = toLonLat(evt.coordinate)
      let clickedFeature = false

      map.forEachFeatureAtPixel(
        evt.pixel,
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
          return undefined
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
    }
    const handler = this._clickHandler
    if (handler) {
      this._clickKey = map.on('click', handler as (evt: unknown) => void)
    }
  }

  /** pointer-move / camera-changed 事件实现（对应 MapRendererEventMap 声明） */
  _setupPointerHandlers(): void {
    const map = this.map
    if (!map) return
    // pointer-move：实时回传鼠标经纬度（坐标从 EPSG:3857 反算到 WGS84）
    this._pointerMoveHandler = (evt) => {
      const coord = toLonLat((evt as MapBrowserEvent<PointerEvent>).coordinate)
      this.emit('pointer-move', { lng: coord[0], lat: coord[1] })
    }
    const handler = this._pointerMoveHandler
    if (handler) {
      map.on('pointermove', handler)
    }

    // camera-changed：moveend 防抖后回传相机状态（避免每帧触发刷爆订阅方）
    this._cameraChangedKey = map.on('moveend', () => {
      if (this._cameraDebounceTimer) {
        clearTimeout(this._cameraDebounceTimer)
      }
      this._cameraDebounceTimer = setTimeout(() => {
        this.emit('camera-changed', this._getCameraState())
        this._cameraDebounceTimer = null
      }, 300)
    })
  }

  addPointLayer(id: string, features: PointFeature[], options: LayerOptions = {}): void {
    const style = this._createPointStyle(options)

    // 大数量点图层启用视口裁剪：R-tree 索引 + moveend 增量更新
    if (features.length > VIEWPORT_CULL_THRESHOLD) {
      this._addCulledPointLayer(id, features, options, style)
      return
    }

    const olFeatures = features.map((item: PointFeature) => {
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
    vectorLayer.setZIndex(options.zIndex ?? LAYER_DEFAULTS.zIndex)
    this.map?.addLayer(vectorLayer)
    this._layers.set(id, {
      instance: vectorLayer,
      visible: true,
      options,
    })
    this._applyPendingVisibility(id)
  }

  /** 大数量点图层的视口裁剪：R-tree 索引（EPSG:3857 投影坐标），初始只渲染视口内要素，moveend 增量更新 */
  _addCulledPointLayer(
    id: string,
    features: PointFeature[],
    options: LayerOptions,
    style: Style | StyleFunction
  ): void {
    const featureType = options?.featureType || 'point'
    // 构建 R-tree 索引项：[minX, minY, maxX, maxY] + 原始数据
    const index = createSpatialIndex<PointFeature>()
    const indexItems = features.map((item: PointFeature) => {
      const { lng, lat } = normalizePoint(item)
      const coord = fromLonLat([lng, lat])
      return { minX: coord[0], minY: coord[1], maxX: coord[0], maxY: coord[1], data: item }
    })
    index.load(indexItems)

    const source = new VectorSource()
    const vectorLayer = new VectorLayer({ source, style })
    vectorLayer.setZIndex(options.zIndex ?? LAYER_DEFAULTS.zIndex)
    this.map?.addLayer(vectorLayer)
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
  _ensureMoveendListener(): void {
    if (this._moveendKey) return
    this._moveendKey =
      this.map?.on('moveend', () => {
        for (const id of this._cullLayers.keys()) {
          this._refreshCulledLayer(id)
        }
      }) ?? null
  }

  /** 刷新单个裁剪图层：查询当前视口内要素并替换 source */
  _refreshCulledLayer(id: string): void {
    const entry = this._cullLayers.get(id)
    if (!entry) return

    // 隐藏图层不参与 moveend 刷新（W4-19）：visible 是面板/registry 权威值，隐藏时跳过省查询
    const layerEntry = this._layers.get(id)
    if (layerEntry && layerEntry.visible === false) return

    const map = this.map
    if (!map) return
    const extent = map.getView().calculateExtent(map.getSize()) as [number, number, number, number]
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
  _createPointStyle(options: LayerOptions): Style | StyleFunction {
    if (!options.labelField) {
      return new Style({
        image: new Circle({
          radius: options.size || 12,
          fill: new Fill({ color: options.color || LAYER_DEFAULTS.color }),
          stroke: new Stroke({ color: LAYER_DEFAULTS.outline, width: 2 }),
        }),
      })
    }
    return (feature: FeatureLike) =>
      new Style({
        image: new Circle({
          radius: options.size || 12,
          fill: new Fill({ color: options.color || LAYER_DEFAULTS.color }),
          stroke: new Stroke({ color: LAYER_DEFAULTS.outline, width: 2 }),
        }),
        text: new Text({
          text: feature.get(options.labelField as string),
          font: '12px sans-serif',
          fill: new Fill({ color: LAYER_DEFAULTS.text }),
          stroke: new Stroke({ color: LAYER_DEFAULTS.outline, width: 2 }),
          offsetY: 15,
        }),
      })
  }
  addPolygonLayer(id: string, features: PolygonFeature[], options: LayerOptions = {}): void {
    // 辅助函数 - 确保坐标环闭合
    const ensureRingClosed = (ring: [number, number][]): [number, number][] | null => {
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
      .map((item: PolygonFeature) => {
        const coordinates = item.coordinates || item.geometry?.coordinates
        if (!coordinates) return null

        // 验证坐标数组有效性
        if (!Array.isArray(coordinates) || coordinates.length === 0) return null

        let polygonCoords: [number, number][][]
        if (item.geometry?.type === 'MultiPolygon') {
          // 验证MultiPolygon坐标结构
          const multi = coordinates as unknown as [number, number][][][]
          if (!Array.isArray(multi[0]) || !Array.isArray(multi[0][0])) return null
          // 验证并闭合每个多边形的坐标环
          polygonCoords = multi
            .map((poly) => {
              const closedRing = ensureRingClosed(poly[0])
              return closedRing
                ? closedRing.map(([lng, lat]) => fromLonLat([lng, lat]) as [number, number])
                : null
            })
            .filter((coords) => coords !== null) as [number, number][][]
          if (polygonCoords.length === 0) return null
        } else {
          // 验证Polygon坐标结构
          const ring = coordinates as [number, number][]
          if (!Array.isArray(ring[0]) || !Array.isArray(ring[0][0])) return null
          // 验证并闭合坐标环
          const closedRing = ensureRingClosed(ring)
          if (!closedRing) return null
          polygonCoords = [
            closedRing.map(([lng, lat]) => fromLonLat([lng, lat]) as [number, number]),
          ]
        }
        const feature = new Feature({
          geometry: new Polygon(polygonCoords),
        })
        feature.setProperties({ ...item, featureType: options.featureType || 'polygon' })
        return feature
      })
      .filter((f) => f !== null) as Feature[]

    const style = this._createPolygonStyle(options)

    const map = this.map
    if (!map) return
    const vectorLayer = new VectorLayer({
      source: new VectorSource({ features: olFeatures }),
      style,
    })
    vectorLayer.setZIndex(options.zIndex ?? LAYER_DEFAULTS.zIndex)
    this.map?.addLayer(vectorLayer)
    this._layers.set(id, {
      instance: vectorLayer,
      visible: true,
      options,
    })
    this._applyPendingVisibility(id)
  }

  /** 增量更新 GeoJSON 图层（W4-06）：复用图层实例，仅替换 source 数据，避免重建闪烁 */
  updateGeoJsonLayer(id: string, geojson: FeatureCollection, options: LayerOptions = {}): void {
    const entry = this._layers.get(id)
    if (!entry || !entry.instance) {
      this.addGeoJsonLayer(id, geojson, options)
      return
    }
    const layer = entry.instance as VectorLayer<VectorSource>
    const source = layer.getSource()
    if (!source) {
      this.addGeoJsonLayer(id, geojson, options)
      return
    }

    const features = new GeoJSON().readFeatures(geojson, {
      featureProjection: WEB_MERCATOR,
    })
    features.forEach((feature) => {
      feature.set('featureType', options.featureType || 'geojson')
    })
    // 样式选项更新（style 是 layer 级，直接替换）
    if (options.style) layer.setStyle(options.style)
    entry.options = { ...entry.options, ...options }

    source.clear()
    source.addFeatures(features)
  }
  _createPolygonStyle(options: LayerOptions): Style {
    return new Style({
      fill: new Fill({ color: options.fillColor || LAYER_DEFAULTS.fill }),
      stroke: new Stroke({
        color: options.strokeColor || LAYER_DEFAULTS.stroke,
        width: options.strokeWidth || 2,
      }),
    })
  }
  addGeoJsonLayer(id: string, geojson: FeatureCollection, options: LayerOptions = {}): void {
    const features = new GeoJSON().readFeatures(geojson, {
      featureProjection: WEB_MERCATOR,
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
    const defaultStyle = (feature: FeatureLike): Style => {
      const geom = feature.getGeometry()
      return geom?.getType() === 'Point' ? pointStyle : polygonStyle
    }
    const vectorLayer = new VectorLayer({
      source: new VectorSource({ features }),
      style: options.style || defaultStyle,
    })
    vectorLayer.setZIndex(options.zIndex ?? LAYER_DEFAULTS.zIndex)
    this.map?.addLayer(vectorLayer)
    this._layers.set(id, {
      instance: vectorLayer,
      visible: true,
      options,
    })
    this._applyPendingVisibility(id)
  }

  // 热力图走独立方法（原设计文档的 addGeoJsonLayer({type:'heatmap'}) 方案未落地），参考 OpenLayers Heatmap 官方示例
  addGeoTIFFLayer(id: string, url: string, options: LayerOptions = {}): boolean {
    // DEM（数字高程模型）山体阴影/高程着色 COG：ol/source/GeoTIFF 自带，无需新增依赖
    // normalize 必须显式 true——false 时单波段数据以数组形式交给渲染器，
    // 抛 "Rendering array data is not yet supported" 崩溃（防版本差异导致回归）
    let source
    try {
      // GeoTIFF options 类型未含 crossOrigin（OL 10 类型缺口），用结构化类型断言补
      source = new GeoTIFF({
        sources: [{ url }],
        crossOrigin: 'anonymous',
        normalize: true,
      } as unknown as ConstructorParameters<typeof GeoTIFF>[0])
    } catch (e) {
      if (import.meta.env.DEV) {
        logger.error(`[OLRenderer] GeoTIFF 源创建失败: ${url}`, e)
      }
      return false
    }
    // 单张瓦片加载失败（404/解码失败）不应冒泡到渲染循环，仅记录，避免整图崩掉
    if (typeof source.on === 'function') {
      source.on('error', (err) => {
        if (import.meta.env.DEV) {
          logger.warn(`[OLRenderer] GeoTIFF 瓦片加载错误: ${url}`, err)
        }
      })
    }
    const layer = new TileLayer({
      source,
      opacity: options.opacity ?? 0.7,
    })
    layer.setZIndex(options.zIndex ?? LAYER_DEFAULTS.zIndex)
    const map = this.map
    if (!map) return false
    map.addLayer(layer)
    this._layers.set(id, {
      instance: layer,
      visible: true,
      options,
    })
    this._applyPendingVisibility(id)
    return true
  }

  addHeatmapLayer(id: string, features: PointFeature[], options: LayerOptions = {}): boolean {
    const {
      weightField = 'value',
      radius = 20,
      blur = 15,
      gradient = LAYER_DEFAULTS.heatmapGradient,
      opacity = 0.6,
    } = options

    // 将 features 数组转为 OpenLayers Feature（坐标归一化走 normalizePoint，含 longitude 别名——W4-03）
    const olFeatures = features.map((f) => {
      const coords = f.geometry?.coordinates
      const { lng, lat } = normalizePoint(coords ? { lng: coords[0], lat: coords[1] } : f)
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
      gradient: [...gradient],
      opacity,
    })

    layer.set('id', id)
    layer.setZIndex(options.zIndex ?? LAYER_DEFAULTS.zIndex)
    const map = this.map
    if (!map) return false
    map.addLayer(layer)
    this._layers.set(id, {
      instance: layer,
      visible: true,
      options,
    })
    this._applyPendingVisibility(id)

    return true
  }

  updateHeatmapLayer(id: string, features: PointFeature[], options: LayerOptions = {}): boolean {
    const entry = this._layers.get(id)
    if (!entry) return false

    const layer = entry.instance as VectorLayer<VectorSource>
    const source = layer.getSource()
    if (!source) return false

    const { weightField: _weightField = 'value' } = options

    const olFeatures = features.map((f) => {
      const coords = f.geometry?.coordinates
      const { lng, lat } = normalizePoint(coords ? { lng: coords[0], lat: coords[1] } : f)
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

  _doSetVisibility(id: string, visible: boolean): void {
    const layer = this._layers.get(id)
    if (layer && layer.instance) {
      ;(layer.instance as { setVisible: (v: boolean) => void }).setVisible(visible)
    }
  }
  /** 覆写基类 removeLayer：先清理裁剪图层状态（索引 + moveend 监听）再走基类移除，防止 _cullLayers 残留与监听泄漏 */
  removeLayer(id: string): void {
    this._removeCullLayer(id)
    super.removeLayer(id)
  }
  _doRemoveLayer(layer: { instance: unknown; visible: boolean; options?: LayerOptions }): void {
    if (layer.instance) {
      this.map?.removeLayer(layer.instance as BaseLayer)
      const instance = layer.instance as {
        getSource?: () => { clear?: () => void; dispose?: () => void }
      }
      if (instance.getSource) {
        const source = instance.getSource()
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
  _removeCullLayer(id: string): void {
    this._cullLayers.delete(id)
    const moveendKey = this._moveendKey
    if (this._cullLayers.size === 0 && moveendKey) {
      // EventsKey.type 为宽 string，un 需 cast 对齐字面量 union 类型
      this.map?.un(moveendKey.type as 'moveend', moveendKey.listener as any)
      this._moveendKey = null
    }
  }
  _doFlyTo(target: FlyToTarget, options: FlyToOptions = {}): void {
    const map = this.map
    if (!map) return
    const view = map.getView()
    if ('layerId' in target && target.layerId) {
      const layer = this._layers.get(target.layerId)
      if (layer && layer.instance) {
        // 验证 source 和 getExtent 方法存在性
        const instance = layer.instance as { getSource?: () => { getExtent?: () => unknown } }
        const source = instance.getSource?.()
        if (source && typeof source.getExtent === 'function') {
          const extent = source.getExtent()
          if (extent) {
            view.fit(extent as [number, number, number, number], {
              duration: options.duration ?? 1000,
            })
            return
          }
        }
      }
    }
    // 数据入口归一化：统一 lng/lon/longitude 字段名
    const { lng, lat } = normalizePoint(target as { lng?: number; lat?: number; lon?: number })
    // height → heightToZoom 同步缩放（曾只认 options.zoom、忽略 height，2D 只有位移没有缩放动画）
    const zoom =
      options.zoom ?? (options.height != null ? heightToZoom(options.height) : view.getZoom())
    view.animate({
      center: fromLonLat([lng, lat]),
      zoom,
      // duration 读 FlyToOptions.duration（毫秒）?? 默认 1000
      duration: options.duration ?? 1000,
    })
  }
  _getCameraState(): CameraState {
    const view = this.map?.getView()
    const center = view?.getCenter()
    if (!view || !center) {
      return { center: { lng: 0, lat: 0 }, zoom: 6 }
    }
    const lonLat = toLonLat(center)
    const zoom = view.getZoom()

    const state: CameraState = {
      center: { lng: lonLat[0], lat: lonLat[1] },
      zoom: zoom ?? undefined,
    }

    logger.debug('[OLRenderer._getCameraState] 导出状态:', state)

    return state
  }
  _setCameraState(state: CameraState): void {
    logger.debug('[OLRenderer._setCameraState] 导入原始状态:', state)

    const view = this.map?.getView()
    if (!view) return
    let zoom: number | undefined

    // 从 Cesium 的 height 反算 OL zoom
    if (state.height != null) {
      zoom = heightToZoom(state.height)
    } else if (state.zoom != null) {
      zoom = state.zoom
    }

    // 钳制在合法范围内
    const clampedZoom = zoom != null ? Math.min(Math.max(zoom, 6), 20) : (view.getZoom() ?? 6)

    // 原子设置 center+zoom，避免分离调用触发的动画冲突导致 view 状态错乱
    view.animate({
      center: fromLonLat([state.center.lng, state.center.lat]),
      zoom: clampedZoom,
      duration: 0,
    })
  }
  setBaseLayer(type: 'image' | 'vector'): void {
    this.baseLayers.image.forEach((l) => l.setVisible(type === 'image'))
    this.baseLayers.vector.forEach((l) => l.setVisible(type === 'vector'))
  }
  startBreathing(lng: number, lat: number): void {
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
    // 呼吸动画层必须置顶（覆盖业务层），保持改动前"最后 add 即最上"的视觉语义
    this._breathingLayer.setZIndex(LAYER_DEFAULTS.zIndexOverlay)
    this.map?.addLayer(this._breathingLayer)
    const animate = () => {
      if (this._breathingLayer) {
        this._breathingLayer.changed()
        this._breathingAnimId = requestAnimationFrame(animate)
      }
    }
    this._breathingAnimId = requestAnimationFrame(animate)
  }
  stopBreathing(): void {
    if (this._breathingAnimId) {
      cancelAnimationFrame(this._breathingAnimId)
      this._breathingAnimId = null
    }
    if (this._breathingLayer) {
      this.map?.removeLayer(this._breathingLayer)
      this._breathingLayer.dispose()
      this._breathingLayer = null
    }
  }
  getType() {
    // 返回 '2d' 与 MapType 一致：原 'ol' 与 mapType==='2d'/'3d' 比较错位（切换白屏、同类型短路）
    return '2d'
  }
  getMap() {
    return this.map
  }
  updateSize() {
    this.map?.updateSize()
  }
  // 水面为 3D 专有能力（Water3DCapability），调用方做能力检查后跳过 2D；呼吸动画为双引擎公共能力，实现见上方
  destroy() {
    super.destroy()
    this.stopBreathing()
    // 清理视口裁剪图层
    this._cullLayers.clear()
    if (this._moveendKey) {
      // EventsKey.listener 为 OL 宽签名，业务回调为窄类型——cast 对齐运行时注销契约（副-03）
      this.map?.un(this._moveendKey.type as 'moveend', this._moveendKey.listener as any)
      this._moveendKey = null
    }
    // 注销 click 监听（W4-21：具名处理器配对注销）
    if (this._clickKey && this._clickHandler) {
      this.map?.un(this._clickKey.type as 'click', this._clickHandler as any)
      this._clickKey = null
      this._clickHandler = null
    }
    // 注销 pointer-move / camera-changed 监听与防抖定时器
    if (this._pointerMoveHandler) {
      this.map?.un('pointermove', this._pointerMoveHandler as any)
      this._pointerMoveHandler = null
    }
    if (this._cameraChangedKey) {
      this.map?.un(this._cameraChangedKey.type as 'moveend', this._cameraChangedKey.listener as any)
      this._cameraChangedKey = null
    }
    if (this._cameraDebounceTimer) {
      clearTimeout(this._cameraDebounceTimer)
      this._cameraDebounceTimer = null
    }
    this.map?.dispose()
    this.map = null
  }
}

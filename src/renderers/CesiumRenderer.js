import { MapRenderer } from './MapRenderer'
import {
  Viewer,
  Cartesian3,
  Cartesian2,
  Color,
  PolygonHierarchy,
  UrlTemplateImageryProvider,
  Math as CesiumMath,
  EllipsoidTerrainProvider,
  ScreenSpaceEventType,
  GeoJsonDataSource,
  Cartographic,
  CallbackProperty,
  VerticalOrigin,
} from 'cesium'
import { MAP_CONFIG, buildTiandituUrl } from '@/config/map'

export class CesiumRenderer extends MapRenderer {
  constructor(container) {
    super(container)
    this.viewer = null
    this.baseLayers = { image: [], vector: [] }
    this._initViewer()
  }

  _initViewer() {
    this.viewer = new Viewer(this.container, {
      terrainProvider: new EllipsoidTerrainProvider(),
      baseLayer: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      timeline: false,
      animation: false,
      creditContainer: document.createElement('div'),
    })

    this._positionCamera()
    this._initBaseLayers()
    this._setupClickHandler()
    this._setupZoomLimits()
  }
  _setupZoomLimits() {
    const controller = this.viewer.scene.screenSpaceCameraController
    controller.minimumZoomDistance = 100
    controller.maximumZoomDistance = 500000
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
  }

  addPolygonLayer(id, features, options = {}) {
    const entities = []

    features.forEach((item) => {
      const coordinates = item.coordinates || item.geometry?.coordinates
      if (!coordinates) return

      const geometryType = item.geometry?.type
      const createPolygon = (polyCoords) => {
        try {
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
          console.warn('创建多边形实体失败:', e)
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
    } catch (error) {
      console.error(`GeoJSON图层 ${id} 加载失败`, error)
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
        requestAnimationFrame(this._breathingAnimation)
      }
    }
    requestAnimationFrame(this._breathingAnimation)
  }
  stopBreathing() {
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
  }
  destroy() {
    super.destroy()
    this.viewer?.destroy()
    this.viewer = null
  }
}

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
import {
  Cartesian2,
  Cartesian3,
  Color,
  GeographicTilingScheme,
  GeoJsonDataSource,
  PointGraphics,
  PolygonHierarchy,
  Rectangle,
  SingleTileImageryProvider,
} from 'cesium'

import { LAYER_DEFAULTS } from '@/shared'
import { logger } from '@/shared'

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
    const dataSource = await GeoJsonDataSource.load(geojson)

    // await 后检查：若有更新的同 id 请求，丢弃本次结果
    if (renderer._geoJsonTokens.get(id) !== token) return

    logger.debug(`[CesiumRenderer] GeoJSON ${id} entities:`, dataSource.entities.values.length)
    dataSource.entities.values.forEach((entity: any) => {
      // properties 可能为 undefined（无属性的 GeoJSON 要素），判空避免崩溃
      if (!entity.properties) entity.properties = {}
      entity.properties.featureType = options.featureType || 'geojson'
      if (entity.polygon) {
        entity.polygon.height = 0.5
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
  // 回退方案仅支持预生成的 hillshade 影像；其它 GeoTIFF 在 3D 下暂不支持
  if (!/hillshade/i.test(url)) {
    logger.debug(`[CesiumRenderer] addGeoTIFFLayer 仅支持 hillshade 回退，跳过: ${url}`)
    return false
  }

  // 真地形已就绪时 hillshade 回退贴图不再需要：
  // 它是 70% 不透明灰白单张图，盖在天地图底图之上（addImageryProvider 默认顶层），
  // 会遮挡底图（表现为"3D 无底图"）。真地形 z 起伏 + Cesium 光照已取代伪三维明暗。
  if (renderer._terrainReady) {
    logger.debug(`[CesiumRenderer] 真地形已就绪，跳过 hillshade 回退贴图: ${id}`)
    return true
  }

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
    // - 顶层叠加 + 半透明（默认 alpha 0.45）：山体明暗叠在天地图上，既全量一次加载
    //   又能看到地形立体感，不遮挡底图（之前 alpha 0.7 顶层会盖死底图，lowerToBottom
    //   又会完全被天地图盖住看不到明暗——两个极端都试过，取半透明顶层中间态）。
    // - 真 3D mesh（_setupFullDem Primitive）在 vite dev 有 Cesium worker 兼容问题
    //   暂禁用，hillshade 全量贴图作为过渡方案。
    imageryLayer.alpha = options.opacity ?? 0.45
    // 记录 hillshade 图层引用（真地形 mesh 恢复后隐藏/降级用）
    renderer._hillshadeLayer = imageryLayer
    renderer.viewer.imageryLayers.lowerToBottom(imageryLayer)

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

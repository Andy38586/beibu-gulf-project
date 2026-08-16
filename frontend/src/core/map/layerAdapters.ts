/**
 * Layer Adapter Registry：每种 layerType 对应 create/update/remove 一组适配函数。
 * BLM（业务图层管理器）只查 registry 调 adapter，不关心渲染细节；
 * 新增 layerType 只需在此加条目。
 */

import type { FeatureCollection } from 'geojson'

import { logger } from '@/shared'
import type {
  GeoTIFFCapability,
  HeatmapCapability,
  LayerOptions,
  MapRenderer,
  PointFeature,
  PolygonFeature,
  Water3DCapability,
} from '@/types'
import type { LayerType, WaterSurfaceData } from '@/types/core/layerManager'

// ===== 数据形状守卫 =====
// 仅做最小形态校验（数组 / FeatureCollection），把"静默渲染失败"变成"明确抛错"，
// 调用方 catch 后用户可见真实文案；不做完整 schema 校验（避免过度设计）。

/** 要素上限：超限直接抛错，防止误传超大集合拖垮渲染（潜伏 OOM 缺口） */
const MAX_FEATURES = 500_000

function assertPointArray(data: unknown): asserts data is PointFeature[] {
  if (!Array.isArray(data)) {
    throw new Error(
      `[layerAdapters] points/heatmap 图层数据必须是 PointFeature[]，实际: ${typeof data}`
    )
  }
  if (data.length > MAX_FEATURES) {
    throw new Error(
      `[layerAdapters] 要素数超上限（${MAX_FEATURES}），实际 ${data.length}，请分批或裁剪`
    )
  }
}

function assertFeatureCollection(data: unknown): asserts data is FeatureCollection {
  if (
    !data ||
    typeof data !== 'object' ||
    (data as FeatureCollection).type !== 'FeatureCollection'
  ) {
    throw new Error('[layerAdapters] geojson 图层数据必须是 FeatureCollection')
  }
  const features = (data as FeatureCollection).features ?? []
  if (features.length > MAX_FEATURES) {
    throw new Error(
      `[layerAdapters] 要素数超上限（${MAX_FEATURES}），实际 ${features.length}，请分批或裁剪`
    )
  }
}

function assertPolygonArray(data: unknown): asserts data is PolygonFeature[] {
  if (!Array.isArray(data)) {
    throw new Error(`[layerAdapters] polygon 图层数据必须是 PolygonFeature[]，实际: ${typeof data}`)
  }
  if (data.length > MAX_FEATURES) {
    throw new Error(
      `[layerAdapters] 要素数超上限（${MAX_FEATURES}），实际 ${data.length}，请分批或裁剪`
    )
  }
}

/** 水面能力检查：渲染器是否实现 Water3DCapability（3D 专用，仅 CesiumRenderer）。
 *  816-专项4 3.2：对外导出——业务页注册水面/DEM 前用能力检查替代 getType() 引擎判断（02 §5.3 能力检查设计） */
export function isWater3DCapable(
  renderer: MapRenderer
): renderer is MapRenderer & Water3DCapability {
  return typeof (renderer as Partial<Water3DCapability>).addWaterSurface === 'function'
}

/** GeoTIFF 能力检查：Cesium 独占（3D hillshade 贴图回退；OL 2D COG 已按 Cesium 独占定义移除） */
function isGeoTIFFCapable(renderer: MapRenderer): renderer is MapRenderer & GeoTIFFCapability {
  return typeof (renderer as Partial<GeoTIFFCapability>).addGeoTIFFLayer === 'function'
}

/** 热力图能力检查：仅 OL 实现（2D Only） */
function isHeatmapCapable(renderer: MapRenderer): renderer is MapRenderer & HeatmapCapability {
  return typeof (renderer as Partial<HeatmapCapability>).addHeatmapLayer === 'function'
}

/** Adapter 函数签名 */
interface LayerAdapter {
  create: (renderer: MapRenderer, key: string, data: unknown, options: LayerOptions) => void
  update: (renderer: MapRenderer, key: string, data: unknown, options: LayerOptions) => void
  remove: (renderer: MapRenderer, key: string) => void
  /** 可选显隐分派：特殊图层（如水面不存于普通图层表）在此直接委派，避免落入待定显隐队列 */
  setVisibility?: (renderer: MapRenderer, key: string, visible: boolean) => void
}

export const LAYER_ADAPTERS: Record<LayerType, LayerAdapter> = {
  heatmap: {
    // addHeatmapLayer 为可选能力（2D Only），经类型守卫后调用，替代 ! 断言
    create: (renderer, key, data, options) => {
      assertPointArray(data)
      if (!isHeatmapCapable(renderer)) {
        logger.warn(`[layerAdapters] heatmap 图层 ${key} 当前渲染器不支持，跳过`)
        return
      }
      renderer.addHeatmapLayer(key, data, options)
    },
    update: (renderer, key, data, options) => {
      assertPointArray(data)
      if (!isHeatmapCapable(renderer)) {
        logger.warn(`[layerAdapters] heatmap 图层 ${key} 更新跳过（渲染器不支持）`)
        return
      }
      renderer.updateHeatmapLayer(key, data, options)
    },
    remove: (renderer, key) => {
      renderer.removeLayer(key)
    },
  },

  geojson: {
    create: (renderer, key, data, options) => {
      assertFeatureCollection(data)
      renderer.addGeoJsonLayer(key, data, options)
    },
    update: (renderer, key, data, options) => {
      assertFeatureCollection(data)
      // 优先走渲染器增量更新（复用 dataSource/source，避免重建闪烁）；
      // 无增量能力的渲染器回退 remove+add
      const updater = (
        renderer as Partial<MapRenderer> & {
          updateGeoJsonLayer?: (id: string, data: FeatureCollection, options: LayerOptions) => void
        }
      ).updateGeoJsonLayer
      if (typeof updater === 'function') {
        updater.call(renderer, key, data, options)
      } else {
        renderer.removeLayer(key)
        renderer.addGeoJsonLayer(key, data, options)
      }
    },
    remove: (renderer, key) => {
      renderer.removeLayer(key)
    },
  },

  points: {
    create: (renderer, key, data, options) => {
      assertPointArray(data)
      renderer.addPointLayer(key, data, options)
    },
    update: (renderer, key, data, options) => {
      assertPointArray(data)
      renderer.removeLayer(key)
      renderer.addPointLayer(key, data, options)
    },
    remove: (renderer, key) => {
      renderer.removeLayer(key)
    },
  },

  polygon: {
    create: (renderer, key, data, options) => {
      assertPolygonArray(data)
      renderer.addPolygonLayer(key, data, options)
    },
    update: (renderer, key, data, options) => {
      assertPolygonArray(data)
      renderer.removeLayer(key)
      renderer.addPolygonLayer(key, data, options)
    },
    remove: (renderer, key) => {
      renderer.removeLayer(key)
    },
  },

  waterSurface: {
    // 水面为 3D 专有能力（Water3DCapability），OLRenderer 无此方法；
    // 能力检查替代基类 no-op stub：不支持的渲染器上跳过并 warn
    create: (renderer, key, data, options) => {
      if (!isWater3DCapable(renderer)) {
        logger.warn(
          `[layerAdapters] waterSurface 图层仅 3D 渲染器支持，当前 ${renderer.getType()} 跳过: ${key}`
        )
        return
      }
      const payload = data as WaterSurfaceData
      // addWaterSurface 为 async（真地形采样基准），rejection 兜底防浮动 Promise
      void Promise.resolve(
        renderer.addWaterSurface(key, payload.coordinates, payload.height, options)
      ).catch((e) => {
        if (import.meta.env.DEV) {
          logger.warn(`[layerAdapters] 水面图层 ${key} 创建失败（异步）:`, e)
        }
      })
    },
    update: (renderer, key, data, _options) => {
      if (!isWater3DCapable(renderer)) return
      const payload = data as WaterSurfaceData
      renderer.updateWaterLevel(key, payload.height)
    },
    remove: (renderer, key) => {
      if (!isWater3DCapable(renderer)) return
      renderer.removeWaterSurface(key)
    },
    // 水面不存于普通图层表，默认显隐会落入待定队列失效——直接委派 setWaterSurfaceVisibility
    setVisibility: (renderer, key, visible) => {
      if (!isWater3DCapable(renderer)) return
      renderer.setWaterSurfaceVisibility(key, visible)
    },
  },

  geotiff: {
    // addGeoTIFFLayer 为 Cesium 独占能力（3D hillshade 贴图回退；OL 2D 已按独占定义移除），
    // 经类型守卫后调用；data 为 hillshade PNG 路径。3D 下 DEM（数字高程模型）也是独立影像图层，
    // 与普通图层走同一显隐语义，不做 terrainProvider 特殊处理
    create: (renderer, key, data, options) => {
      if (!isGeoTIFFCapable(renderer)) {
        logger.warn(`[layerAdapters] geotiff 图层 ${key} 当前渲染器不支持，跳过`)
        return
      }
      renderer.addGeoTIFFLayer(key, data as string, options)
    },
    update: (renderer, key, data, options) => {
      if (!isGeoTIFFCapable(renderer)) {
        logger.warn(`[layerAdapters] geotiff 图层 ${key} 更新跳过（渲染器不支持）`)
        return
      }
      renderer.removeLayer(key)
      renderer.addGeoTIFFLayer(key, data as string, options)
    },
    remove: (renderer, key) => {
      renderer.removeLayer(key)
    },
  },

  // 预留: entity, primitive, 3dtiles, volume, terrain ...
}

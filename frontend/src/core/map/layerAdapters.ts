/**
 * Layer Adapter Registry
 * 每种 layerType 对应一组 adapter 函数：
 * - create(renderer, key, data, options) → 首次创建图层
 * - update(renderer, key, data, options) → 更新图层数据
 * - remove(renderer, key)               → 销毁图层
 * Manager 不关心具体渲染逻辑，只查 registry 调 adapter。
 * 新增 layerType 只需在这里加条目，不碰 Manager。
 */

import type { FeatureCollection } from 'geojson'

import { logger } from '@/shared'
import type {
  LayerOptions,
  MapRenderer,
  PointFeature,
  PolygonFeature,
  Water3DCapability,
} from '@/types'
import type { LayerType, WaterSurfaceData } from '@/types/core/layerManager'

// ===== 数据形状守卫（TS-2：根治 H-1/H-2 类"静默错误形状"bug）=====
// 仅做最小形态校验（数组 / FeatureCollection），不做完整 schema 校验（避免过度设计）。
// 效果：错误形状从"静默渲染失败"变成"明确抛错"，调用方 catch → 用户可见真实文案。
function assertPointArray(data: unknown): asserts data is PointFeature[] {
  if (!Array.isArray(data)) {
    throw new Error(
      `[layerAdapters] points/heatmap 图层数据必须是 PointFeature[]，实际: ${typeof data}`
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
}

function assertPolygonArray(data: unknown): asserts data is PolygonFeature[] {
  if (!Array.isArray(data)) {
    throw new Error(`[layerAdapters] polygon 图层数据必须是 PolygonFeature[]，实际: ${typeof data}`)
  }
}

/** 水面能力检查（a036）：渲染器是否实现 Water3DCapability（仅 CesiumRenderer） */
function isWater3DCapable(renderer: MapRenderer): renderer is MapRenderer & Water3DCapability {
  return typeof (renderer as Partial<Water3DCapability>).addWaterSurface === 'function'
}

/** Adapter 函数签名 */
interface LayerAdapter {
  create: (renderer: MapRenderer, key: string, data: unknown, options: LayerOptions) => void
  update: (renderer: MapRenderer, key: string, data: unknown, options: LayerOptions) => void
  remove: (renderer: MapRenderer, key: string) => void
}

export const LAYER_ADAPTERS: Record<LayerType, LayerAdapter> = {
  heatmap: {
    // addHeatmapLayer/updateHeatmapLayer 在接口中为可选（2D Only），此处断言非空
    create: (renderer, key, data, options) => {
      assertPointArray(data)
      renderer.addHeatmapLayer!(key, data, options)
    },
    update: (renderer, key, data, options) => {
      assertPointArray(data)
      renderer.updateHeatmapLayer!(key, data, options)
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
      renderer.removeLayer(key)
      renderer.addGeoJsonLayer(key, data, options)
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
    // 水面为 3D 专有能力（a036 拆分后 Water3DCapability），OLRenderer 无此方法。
    // 能力检查替代原基类 no-op stub：2D 渲染器（引擎切换/reapplyAll 场景）上跳过并 warn，
    // 不再依赖"返回 false 的空实现"。
    create: (renderer, key, data, options) => {
      if (!isWater3DCapable(renderer)) {
        logger.warn(
          `[layerAdapters] waterSurface 图层仅 3D 渲染器支持，当前 ${renderer.getType()} 跳过: ${key}`
        )
        return
      }
      const payload = data as WaterSurfaceData
      renderer.addWaterSurface(key, payload.coordinates, payload.height, options)
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
  },

  geotiff: {
    // addGeoTIFFLayer 在接口中为可选（2D Only），此处断言非空
    // data 为 COG 文件 URL 字符串（如 '/static/dem/dem_hillshade.tif'）
    create: (renderer, key, data, options) => {
      renderer.addGeoTIFFLayer!(key, data as string, options)
    },
    update: (renderer, key, data, options) => {
      renderer.removeLayer(key)
      renderer.addGeoTIFFLayer!(key, data as string, options)
    },
    remove: (renderer, key) => {
      renderer.removeLayer(key)
    },
  },

  // 预留: entity, primitive, 3dtiles, volume, terrain ...
}

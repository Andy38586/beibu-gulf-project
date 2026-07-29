/**
 * Layer Adapter Registry
 *
 * 每种 layerType 对应一组 adapter 函数：
 * - create(renderer, key, data, options) → 首次创建图层
 * - update(renderer, key, data, options) → 更新图层数据
 * - remove(renderer, key)               → 销毁图层
 *
 * Manager 不关心具体渲染逻辑，只查 registry 调 adapter。
 * 新增 layerType 只需在这里加条目，不碰 Manager。
 */

import type { FeatureCollection } from 'geojson'

import type { LayerOptions, MapRenderer, PointFeature, PolygonFeature } from '@/types'
import type { LayerType } from '@/types/core/layerManager'

/** 水面图层数据载荷 */
interface WaterSurfaceData {
  coordinates: [number, number][]
  height: number
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
      renderer.addHeatmapLayer!(key, data as PointFeature[], options)
    },
    update: (renderer, key, data, options) => {
      renderer.updateHeatmapLayer!(key, data as PointFeature[], options)
    },
    remove: (renderer, key) => {
      renderer.removeLayer(key)
    },
  },

  geojson: {
    create: (renderer, key, data, options) => {
      renderer.addGeoJsonLayer(key, data as FeatureCollection, options)
    },
    update: (renderer, key, data, options) => {
      renderer.removeLayer(key)
      renderer.addGeoJsonLayer(key, data as FeatureCollection, options)
    },
    remove: (renderer, key) => {
      renderer.removeLayer(key)
    },
  },

  points: {
    create: (renderer, key, data, options) => {
      renderer.addPointLayer(key, data as PointFeature[], options)
    },
    update: (renderer, key, data, options) => {
      renderer.removeLayer(key)
      renderer.addPointLayer(key, data as PointFeature[], options)
    },
    remove: (renderer, key) => {
      renderer.removeLayer(key)
    },
  },

  polygon: {
    create: (renderer, key, data, options) => {
      renderer.addPolygonLayer(key, data as PolygonFeature[], options)
    },
    update: (renderer, key, data, options) => {
      renderer.removeLayer(key)
      renderer.addPolygonLayer(key, data as PolygonFeature[], options)
    },
    remove: (renderer, key) => {
      renderer.removeLayer(key)
    },
  },

  waterSurface: {
    // addWaterSurface 等在接口中为可选（3D Only），此处断言非空
    create: (renderer, key, data, options) => {
      const payload = data as WaterSurfaceData
      renderer.addWaterSurface!(key, payload.coordinates, payload.height, options)
    },
    update: (renderer, key, data, _options) => {
      const payload = data as WaterSurfaceData
      renderer.updateWaterLevel!(key, payload.height)
    },
    remove: (renderer, key) => {
      renderer.removeWaterSurface!(key)
    },
  },

  // 预留: entity, primitive, 3dtiles, volume, terrain ...
}

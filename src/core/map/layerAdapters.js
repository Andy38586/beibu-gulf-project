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

export const LAYER_ADAPTERS = {
  heatmap: {
    create: (renderer, key, data, options) => {
      renderer.addHeatmapLayer(key, data, options)
    },
    update: (renderer, key, data, options) => {
      renderer.updateHeatmapLayer(key, data, options)
    },
    remove: (renderer, key) => {
      renderer.removeLayer(key)
    },
  },

  geojson: {
    create: (renderer, key, data, options) => {
      renderer.addGeoJsonLayer(key, data, options)
    },
    update: (renderer, key, data, options) => {
      renderer.removeLayer(key)
      renderer.addGeoJsonLayer(key, data, options)
    },
    remove: (renderer, key) => {
      renderer.removeLayer(key)
    },
  },

  points: {
    create: (renderer, key, data, options) => {
      renderer.addPointLayer(key, data, options)
    },
    update: (renderer, key, data, options) => {
      renderer.removeLayer(key)
      renderer.addPointLayer(key, data, options)
    },
    remove: (renderer, key) => {
      renderer.removeLayer(key)
    },
  },

  polygon: {
    create: (renderer, key, data, options) => {
      renderer.addPolygonLayer(key, data, options)
    },
    update: (renderer, key, data, options) => {
      renderer.removeLayer(key)
      renderer.addPolygonLayer(key, data, options)
    },
    remove: (renderer, key) => {
      renderer.removeLayer(key)
    },
  },

  waterSurface: {
    create: (renderer, key, data, options) => {
      renderer.addWaterSurface(key, data.coordinates, data.height, options)
    },
    update: (renderer, key, data, _options) => {
      renderer.updateWaterLevel(key, data.height)
    },
    remove: (renderer, key) => {
      renderer.removeWaterSurface(key)
    },
  },

  // 预留: entity, primitive, 3dtiles, volume, terrain ...
}

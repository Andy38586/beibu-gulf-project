/**
 * BusinessLayerManager
 *
 * 业务数据驱动的地图图层生命周期管理器。
 *
 * 职责：
 * 1. 接收业务模块的图层描述符（layerType + data + options）
 * 2. 查 Adapter Registry 分派到正确的渲染器方法
 * 3. 在 layerCatalog (mapStore) 中注册/更新/移除条目
 * 4. LayerControlPanel 通过 layerCatalog 读取状态
 *
 * API:
 *   register(key, { label, layerType, data, options, visible })
 *   updateData(key, { data, options })       // 不改变 visible
 *   setVisible(key, visible)                  // LayerControlPanel 入口
 *   remove(key)
 *   has(key) → boolean
 *
 * 关键约束：
 * - Manager 不持有 renderer 引用，每次都从 mapStore.currentRenderer 动态获取
 * - layerCatalog 条目只存元数据，不存 renderer 对象
 * - updateData 不覆盖 visible 状态
 */

import { LAYER_ADAPTERS } from './layerAdapters.js'

export class BusinessLayerManager {
  /**
   * @param {object} mapStore - Pinia mapStore 实例
   */
  constructor(mapStore) {
    this._mapStore = mapStore
    this._registry = new Map()
  }

  /**
   * 获取当前活跃的 renderer（动态，不缓存）
   */
  _getRenderer() {
    return this._mapStore.currentRenderer
  }

  /**
   * 获取 layerType 对应的 adapter
   */
  _getAdapter(layerType) {
    const adapter = LAYER_ADAPTERS[layerType]
    if (!adapter) {
      console.warn(`[BusinessLayerManager] 未知 layerType: ${layerType}`)
      return null
    }
    return adapter
  }

  /**
   * 注册新业务图层
   *
   * @param {string} key
   * @param {object} descriptor
   * @param {string} descriptor.label       - LayerControlPanel 显示名
   * @param {string} descriptor.layerType   - 'heatmap' | 'geojson' | 'points' | 'polygon' | 'waterSurface'
   * @param {*}      descriptor.data        - 业务数据（格式取决于 layerType）
   * @param {object} descriptor.options     - 样式参数
   * @param {boolean} descriptor.visible    - 初始可见性，默认 true
   */
  register(key, { label, layerType, data, options = {}, visible = true }) {
    if (this._registry.has(key)) {
      console.warn(`[BusinessLayerManager] 图层 ${key} 已注册，请使用 updateData 更新数据`)
      return
    }

    const adapter = this._getAdapter(layerType)
    if (!adapter) return

    // 保存元数据
    this._registry.set(key, { layerType, options })

    // 注册到 layerCatalog（只存元数据，不存 renderer 对象）
    this._mapStore.registerBusinessLayer(key, label, layerType, visible)

    // 如果可见且有数据，立即渲染
    if (visible && data != null) {
      const renderer = this._getRenderer()
      if (renderer) {
        adapter.create(renderer, key, data, options)
      }
    }
  }

  /**
   * 更新图层数据
   *
   * 不改变 visible 状态。如果当前可见则立即重建图层；不可见则只缓存数据。
   *
   * @param {string} key
   * @param {object} payload
   * @param {*}      payload.data
   * @param {object} payload.options
   */
  updateData(key, { data, options }) {
    const meta = this._registry.get(key)
    if (!meta) {
      throw new Error(`[BusinessLayerManager] 图层 "${key}" 未注册，请先调用 register('${key}', ...)`)
    }

    const adapter = this._getAdapter(meta.layerType)
    if (!adapter) return

    // 合并 options
    if (options) {
      meta.options = { ...meta.options, ...options }
    }

    // 查找 catalog 条目确认可见性
    const catalogEntry = this._mapStore.layerCatalog.find((e) => e.key === key)
    if (!catalogEntry || !catalogEntry.visible) {
      return
    }

    // 可见 → 更新图层
    const renderer = this._getRenderer()
    if (renderer) {
      adapter.update(renderer, key, data, meta.options)
    }
  }

  /**
   * 设置显隐
   *
   * LayerControlPanel 通过此方法控制图层显隐，
   * 不直接操作 renderer。
   *
   * @param {string} key
   * @param {boolean} visible
   */
  setVisible(key, visible) {
    const catalogEntry = this._mapStore.layerCatalog.find((e) => e.key === key)
    if (!catalogEntry) {
      console.warn(`[BusinessLayerManager] 图层 ${key} 不在 catalog 中`)
      return
    }

    catalogEntry.visible = visible
    const renderer = this._getRenderer()
    if (!renderer) return

    // 用 renderer.setVisibility 来显隐，不销毁图层
    // 图层数据仍保留在 renderer 内部，toggle 回来时直接可见
    renderer.setVisibility(key, visible)
  }

  /**
   * 移除业务图层
   *
   * 从 renderer 和 layerCatalog 同时移除。
   */
  remove(key) {
    const meta = this._registry.get(key)
    if (meta) {
      const adapter = this._getAdapter(meta.layerType)
      if (adapter) {
        const renderer = this._getRenderer()
        if (renderer) {
          adapter.remove(renderer, key)
        }
      }
      this._registry.delete(key)
    }

    this._mapStore.removeLayer(key)
  }

  /**
   * 批量移除所有已注册的业务图层
   */
  removeAll() {
    for (const key of this._registry.keys()) {
      this.remove(key)
    }
  }

  /**
   * 检查图层是否已注册
   */
  has(key) {
    return this._registry.has(key)
  }

  /**
   * 获取图层元数据
   */
  getMeta(key) {
    return this._registry.get(key) || null
  }
}

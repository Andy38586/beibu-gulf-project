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

import type { LayerEntry, LayerOptions, MapRenderer } from '@/types'
import type { LayerType } from '@/types/core/layerManager'

import { LAYER_ADAPTERS } from './layerAdapters'

/** mapStore 最小接口 — 仅声明 BusinessLayerManager 实际使用的方法 */
interface MapStoreLike {
  currentRenderer: MapRenderer | null
  layerCatalog: LayerEntry[]
  registerBusinessLayer(key: string, label: string, layerType: LayerType, visible: boolean): void
  setLayerVisible(key: string, visible: boolean): void
  removeLayer(key: string): void
}

/** 图层注册描述符 */
interface LayerDescriptor {
  label: string
  layerType: LayerType
  data: unknown
  options?: LayerOptions
  visible?: boolean
}

/** updateData 载荷 */
interface UpdateDataPayload {
  data?: unknown
  options?: LayerOptions
}

/** 内部注册表条目 */
interface RegistryEntry {
  layerType: LayerType
  options: LayerOptions
  data: unknown
}

export class BusinessLayerManager {
  private _mapStore: MapStoreLike | null
  private _registry: Map<string, RegistryEntry>

  constructor(mapStore: MapStoreLike) {
    this._mapStore = mapStore
    this._registry = new Map()
  }

  /** 获取当前活跃的 renderer（动态，不缓存） */
  private _getRenderer(): MapRenderer | null {
    return this._mapStore?.currentRenderer ?? null
  }

  /** 获取 layerType 对应的 adapter */
  private _getAdapter(layerType: LayerType) {
    const adapter = LAYER_ADAPTERS[layerType]
    if (!adapter) {
      console.warn(`[BusinessLayerManager] 未知 layerType: ${layerType}`)
      return null
    }
    return adapter
  }

  /**
   * 注册新业务图层
   */
  register(
    key: string,
    { label, layerType, data, options = {}, visible = true }: LayerDescriptor
  ): void {
    if (this._registry.has(key)) {
      console.warn(`[BusinessLayerManager] 图层 ${key} 已注册，请使用 updateData 更新数据`)
      return
    }

    const adapter = this._getAdapter(layerType)
    if (!adapter) return

    // 保存元数据
    this._registry.set(key, { layerType, options, data })

    // 注册到 layerCatalog（只存元数据，不存 renderer 对象）
    this._mapStore?.registerBusinessLayer(key, label, layerType, visible)

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
   */
  updateData(key: string, { data, options }: UpdateDataPayload): void {
    const meta = this._registry.get(key)
    if (!meta) {
      throw new Error(
        `[BusinessLayerManager] 图层 "${key}" 未注册，请先调用 register('${key}', ...)`
      )
    }

    const adapter = this._getAdapter(meta.layerType)
    if (!adapter) return

    // 合并 options
    if (options) {
      meta.options = { ...meta.options, ...options }
    }
    // 持久化数据，供引擎切换后 reapplyAll 重绘
    if (data !== undefined) {
      meta.data = data
    }

    // 查找 catalog 条目确认可见性
    const catalogEntry = this._mapStore?.layerCatalog.find((e) => e.key === key)
    if (!catalogEntry || !catalogEntry.visible) {
      return
    }

    // 可见 → 更新图层
    const renderer = this._getRenderer()
    if (renderer) {
      adapter.update(renderer, key, meta.data, meta.options)
    }
  }

  /**
   * 将已注册且可见的业务图层重新应用到指定 renderer
   *
   * 用于 2D↔3D 引擎切换后：旧 renderer 被销毁，新 renderer 上没有图层。
   * registry 在 App 级持久，业务页面不会因切换引擎而重新 register，
   * 因此在 renderer 切换时把内存中的图层数据重绘到新 renderer。
   */
  reapplyAll(renderer: MapRenderer | null = this._getRenderer()): void {
    if (!renderer) return
    for (const [key, meta] of this._registry.entries()) {
      if (meta.data == null) continue
      const catalogEntry = this._mapStore?.layerCatalog.find((e) => e.key === key)
      if (!catalogEntry || !catalogEntry.visible) continue
      const adapter = this._getAdapter(meta.layerType)
      if (!adapter) continue
      adapter.create(renderer, key, meta.data, meta.options)
    }
  }

  /**
   * 设置显隐
   *
   * LayerControlPanel 通过此方法控制图层显隐，不直接操作 renderer。
   */
  setVisible(key: string, visible: boolean): void {
    const catalogEntry = this._mapStore?.layerCatalog.find((e) => e.key === key)
    if (!catalogEntry) {
      console.warn(`[BusinessLayerManager] 图层 ${key} 不在 catalog 中`)
      return
    }

    // 通过 store action 修改可见性，不直接改 catalogEntry.visible
    // 好处：Pinia 正确追踪状态变更、DevTools 可记录 action、未来可加 side effect
    this._mapStore?.setLayerVisible(key, visible)
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
  remove(key: string): void {
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

    this._mapStore?.removeLayer(key)
  }

  /** 批量移除所有已注册的业务图层 */
  removeAll(): void {
    for (const key of this._registry.keys()) {
      this.remove(key)
    }
  }

  /** 检查图层是否已注册 */
  has(key: string): boolean {
    return this._registry.has(key)
  }

  /** 获取图层元数据 */
  getMeta(key: string): RegistryEntry | null {
    return this._registry.get(key) ?? null
  }

  /** 销毁管理器，清理所有业务图层 */
  destroy(): void {
    this.removeAll()
    this._registry.clear()
    this._mapStore = null
  }
}

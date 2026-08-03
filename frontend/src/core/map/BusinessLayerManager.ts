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

import { logger } from '@/shared'
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
  /** 图层面板显示名（catalog 被引擎切换清空后由 reapplyAll 重建条目时使用） */
  label: string
  layerType: LayerType
  options: LayerOptions
  data: unknown
  /** 图层可见性（App 级持久，独立于 layerCatalog）
   * @arch-note a016-D06: catalog 会被引擎切换时的 clearLayerCatalog() 清空，
   * reapplyAll 若依赖 catalog 找条目会全部跳过 → 业务图层 2D↔3D 切换后丢失。
   * 可见性以本 registry 为准，reapplyAll/setVisible 不依赖 catalog。 */
  visible: boolean
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
      logger.debug(`[BusinessLayerManager] 未知 layerType: ${layerType}`)
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
      logger.debug(`[BusinessLayerManager] 图层 ${key} 已注册，请使用 updateData 更新数据`)
      return
    }

    const adapter = this._getAdapter(layerType)
    if (!adapter) return

    // 保存元数据（可见性存 registry，不依赖 catalog —— 引擎切换时 catalog 会被清空）
    this._registry.set(key, { label, layerType, options, data, visible })

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
    // 更新数据
    if (data !== undefined) {
      meta.data = data
    }

    // 可见性以 registry 为准（不依赖 catalog —— 引擎切换时 catalog 被清空）
    if (!meta.visible) {
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
   *
   * @arch-note a016-D06: 可见性以本类 _registry 为准（register/setVisible 维护），
   * 不依赖 layerCatalog —— 引擎切换时 UnifiedMap.setupLayers→clearLayers→clearLayerCatalog
   * 会把 catalog 清空，若此处仍查 catalog 则所有业务图层被跳过，切换后直接丢失。
   * @arch-note a018-D06: clearLayerCatalog 同样清掉了业务图层的 catalog 条目，
   * 若只重绘视觉实例，LayerControlPanel 会丢失勾选项（水面/淹没/设施/真实地形消失）。
   * 此处按 registry 重建缺失的 catalog 条目（幂等：已存在则跳过，visible 以 registry 为准）。
   * @arch-note a020: adapter.create 必须逐层容错 —— 单个图层渲染失败（如 Cesium
   * DeveloperError）不应中断整个 reapplyAll，否则排在其后的图层全部丢到新引擎。
   * 引擎切换是批量重绘，任何一层失败只 warn 该层并继续。
   */
  reapplyAll(renderer: MapRenderer | null = this._getRenderer()): void {
    if (!renderer) return
    for (const [key, meta] of this._registry.entries()) {
      if (meta.data == null) continue
      if (!meta.visible) continue
      const adapter = this._getAdapter(meta.layerType)
      if (!adapter) continue
      // 重建被 clearLayerCatalog 清掉的目录条目（不移除不覆盖，只补缺）
      const catalog = this._mapStore?.layerCatalog ?? []
      if (!catalog.some((e: LayerEntry) => e.key === key)) {
        this._mapStore?.registerBusinessLayer(key, meta.label, meta.layerType, meta.visible)
      }
      try {
        adapter.create(renderer, key, meta.data, meta.options)
      } catch (e) {
        // a020: 单层失败不拖垮整批（引擎切换时其它图层仍应上屏）
        logger.warn(`[BusinessLayerManager] reapplyAll 重绘图层 ${key} 失败（已跳过该层）:`, e)
      }
    }
  }

  /**
   * 设置显隐
   *
   * LayerControlPanel 通过此方法控制图层显隐，不直接操作 renderer。
   */
  setVisible(key: string, visible: boolean): void {
    const meta = this._registry.get(key)
    if (!meta) {
      logger.debug(`[BusinessLayerManager] 图层 ${key} 不在 registry 中`)
      return
    }

    // 先更新 registry 可见性（reapplyAll 的数据源），再更新 catalog（UI 展示）
    meta.visible = visible
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

  /**
   * 从指定 renderer 移除所有业务图层的视觉实例（不删除 registry 条目）。
   *
   * 用于 2D↔3D 引擎切换：UnifiedMap 的 OL/Cesium 渲染器实例长期复用、不销毁，
   * 业务图层会在两个渲染器上都留下视觉实例。切换时必须把「停用(old)」与
   * 「将启用(new)」渲染器上的实例清空，只保留 reapplyAll 按 registry 重绘的图层，
   * 否则：
   *  - 孤儿图层（如洪涝页 dem-hillshade GeoTIFF）跨页残留，切回该引擎时被渲染，
   *    抛 "Rendering array data is not yet supported" 崩掉整个渲染循环；
   *  - reapplyAll 对同 key 再次 add 会叠加重复图层。
   *
   * 注意：只遍历 registry 中的条目。registry 之外的孤儿（如本方法介入前已残留的）
   * 由渲染器自身在切换时重建/销毁保证，本方法负责防止新孤儿形成。
   */
  removeAllFromRenderer(renderer: MapRenderer | null): void {
    if (!renderer) return
    for (const [key, meta] of this._registry.entries()) {
      const adapter = this._getAdapter(meta.layerType)
      if (!adapter) continue
      try {
        adapter.remove(renderer, key)
      } catch (e) {
        logger.warn(`[BusinessLayerManager] 从渲染器移除图层 ${key} 失败:`, e)
      }
    }
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

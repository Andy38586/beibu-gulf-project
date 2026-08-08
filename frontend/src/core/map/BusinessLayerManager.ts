/**
 * BusinessLayerManager
 * 业务数据驱动的地图图层生命周期管理器。
 * 职责：
 * 1. 接收业务模块的图层描述符（layerType + data + options）
 * 2. 查 Adapter Registry 分派到正确的渲染器方法
 * 3. 在 layerCatalog (mapStore) 中注册/更新/移除条目
 * 4. LayerControlPanel 通过 layerCatalog 读取状态
 * API:
 * register(key, { label, layerType, data, options, visible })
 * updateData(key, { data, options })       // 不改变 visible
 * setVisible(key, visible)                  // LayerControlPanel 入口
 * remove(key)
 * has(key) → boolean
 * 关键约束：
 * - Manager 不持有 renderer 引用，每次都从 mapStore.currentRenderer 动态获取
 * - layerCatalog 条目只存元数据，不存 renderer 对象
 * - updateData 不覆盖 visible 状态
 */

import { perfTimeFn } from '@/shared/utils/perfReporter'
import { logger } from '@/shared'
import type { LayerEntry, LayerOptions, MapRenderer } from '@/types'
import type { LayerType } from '@/types/core/layerManager'

import { LAYER_ADAPTERS } from './layerAdapters'

/** BLM 事件载荷：图层渲染失败（manager 只上报，不决定 UI——UI 层 App.vue 监听 → toast） */
export interface LayerErrorPayload {
  key: string
  label: string
}

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
   * catalog 会被引擎切换时的 clearLayerCatalog() 清空，
   * reapplyAll 若依赖 catalog 找条目会全部跳过 → 业务图层 2D↔3D 切换后丢失。
   * 可见性以本 registry 为准，reapplyAll/setVisible 不依赖 catalog。 */
  visible: boolean
}

export class BusinessLayerManager {
  private _mapStore: MapStoreLike | null
  private _registry: Map<string, RegistryEntry>
  /** 图层错误回调（2026-08-08：原完整事件发射器仅服务 'layer-error' 单事件单监听，
   * 收敛为单一回调注入——UI 层注册，manager 不感知 UI；YAGNI 收缩） */
  private _errorHandler: ((payload: LayerErrorPayload) => void) | null = null

  constructor(mapStore: MapStoreLike) {
    this._mapStore = mapStore
    this._registry = new Map()
  }

  /** 注册图层错误回调（App.vue 注入 toast；仅一个监听方，无需事件总线） */
  setErrorHandler(handler: (payload: LayerErrorPayload) => void): void {
    this._errorHandler = handler
  }

  /** 获取当前活跃的 renderer（动态，不缓存） */
  private _getRenderer(): MapRenderer | null {
    return this._mapStore?.currentRenderer ?? null
  }

  /**
   * create 失败统一处理（2026-08-08 用户要求）：不自动重试、不在图层控制上做文章——
   * ①回滚状态（registry/catalog visible=false → 按钮白）；②清 pending（防幽灵意图）；
   * ③**上报 layer-error 事件**（manager 不决定 UI——App.vue 监听 → toast）。
   * 单变量原则不变：visible 是唯一状态，失败回滚后"白 = 没显示"真实一致。
   */
  private _handleCreateFailure(key: string, label: string): void {
    const meta = this._registry.get(key)
    if (meta) {
      meta.visible = false
      this._mapStore?.setLayerVisible(key, false)
    }
    // 清待定可见性（防幽灵：pending 记录的是过期意图，create 失败后残留会在
    // 下次 create 时错误应用）
    const renderer = this._getRenderer() as
      | (MapRenderer & { clearPendingVisibility?: (id: string) => void })
      | null
    renderer?.clearPendingVisibility?.(key)
    this._errorHandler?.({ key, label })
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
      logger.debug(
        `[BusinessLayerManager] register ${key}: visible=${visible} data=${data != null} renderer=${!!renderer}`
      )
      if (renderer) {
        // 注意：同步 throw（数据形状守卫 points/geojson 校验）保持向上抛——
        // TS-2 测试断言 register 对非法数据抛错。但 Cesium 的 addGeoJsonLayer 是
        // async（内部 await GeoJsonDataSource.load），且失败在内部 catch + onError
        // （不抛 rejection）——必须注入 onError 感知。失败 → 回滚状态 + toast
        // （用户再按一次重试，不做自动重试）。
        const createOptions = {
          ...options,
          onError: () => this._handleCreateFailure(key, label),
        }
        const result = perfTimeFn(`layer:create:${layerType}`, () =>
          adapter.create(renderer, key, data, createOptions)
        )
        Promise.resolve(result).catch(() => this._handleCreateFailure(key, label))
      }
    } else {
      logger.debug(
        `[BusinessLayerManager] register ${key} 暂不渲染: visible=${visible} data=${data != null}`
      )
    }
  }

  /**
   * 更新图层数据
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
      // P0-3: 图层实例缺失（注册时 data 为 null 跳过了 create,如 forecast 热力图
      // `data: null` 注册后数据到达）时补建,否则 adapter.update 因无 entry 直接失败,
      // 图层永不上屏（预测页热力图首屏缺失的根因）
      if (meta.data != null && !renderer.hasLayer(key)) {
        const createOptions = {
          ...meta.options,
          // 失败 → 回滚状态 + toast（用户再按一次重试）
          onError: () => this._handleCreateFailure(key, meta.label),
        }
        const r = perfTimeFn(`layer:create:${meta.layerType}`, () =>
          adapter.create(renderer, key, meta.data, createOptions)
        )
        // async create（Cesium geojson）rejection 兜底，防 unhandled rejection 吞错
        Promise.resolve(r).catch(() => this._handleCreateFailure(key, meta.label))
      } else {
        const r = perfTimeFn(`layer:update:${meta.layerType}`, () =>
          adapter.update(renderer, key, meta.data, meta.options)
        )
        Promise.resolve(r).catch((e) => {
          logger.warn(`[BusinessLayerManager] updateData update ${key} 失败（异步）:`, e)
        })
      }
    }
  }

  /**
   * 将已注册且可见的业务图层重新应用到指定 renderer
   * 用于 2D↔3D 引擎切换后：旧 renderer 被销毁，新 renderer 上没有图层。
   * registry 在 App 级持久，业务页面不会因切换引擎而重新 register，
   * 因此在 renderer 切换时把内存中的图层数据重绘到新 renderer。
   * 可见性以本类 _registry 为准（register/setVisible 维护），
   * 不依赖 layerCatalog —— 引擎切换时 UnifiedMap.setupLayers→clearLayers→clearLayerCatalog
   * 会把 catalog 清空，若此处仍查 catalog 则所有业务图层被跳过，切换后直接丢失。
   * clearLayerCatalog 同样清掉了业务图层的 catalog 条目，
   * 若只重绘视觉实例，LayerControlPanel 会丢失勾选项（水面/淹没/设施/真实地形消失）。
   * 此处按 registry 重建缺失的 catalog 条目（幂等：已存在则跳过，visible 以 registry 为准）。
   * adapter.create 必须逐层容错 —— 单个图层渲染失败（如 Cesium
   * DeveloperError）不应中断整个 reapplyAll，否则排在其后的图层全部丢到新引擎。
   * 引擎切换是批量重绘，任何一层失败只 warn 该层并继续。
   */
  reapplyAll(renderer: MapRenderer | null = this._getRenderer()): void {
    if (!renderer) return
    logger.debug(
      `[BusinessLayerManager] reapplyAll 开始: renderer=${renderer.getType?.() ?? 'unknown'} registry=${this._registry.size}个图层`
    )
    for (const [key, meta] of this._registry.entries()) {
      // a046：目录条目重建必须在 data==null 判断之前——data==null 的图层
      // （如 flood-area 等 API 返回后渲染）引擎切换时被 clearLayerCatalog 清掉后，
      // 原实现先 continue 跳过了重建 → 面板开关永久丢失（地图照常渲染=渲染与面板脱节）。
      // 条目重建不依赖 data，仅依赖 registry（label/layerType/visible）。
      const catalog = this._mapStore?.layerCatalog ?? []
      if (!catalog.some((e: LayerEntry) => e.key === key)) {
        this._mapStore?.registerBusinessLayer(key, meta.label, meta.layerType, meta.visible)
      }
      if (meta.data == null) {
        logger.debug(`[BusinessLayerManager] reapplyAll ${key} 跳过（data 未就绪）`)
        continue
      }
      if (!meta.visible) {
        logger.debug(`[BusinessLayerManager] reapplyAll ${key} 跳过（visible=false）`)
        continue
      }
      const adapter = this._getAdapter(meta.layerType)
      if (!adapter) continue
      // 防 pending 幽灵（2026-08-08 用户实测"按钮蓝但 2D 不显示"根因）：reapplyAll
      // 是"按 registry 重建"，实例重建后 _applyPendingVisibility 会把旧的 pending 意图
      // （如用户之前关闭时的 false）应用上去 → 图层被隐藏但按钮蓝。重建必须清 pending，
      // 以 registry.visible 为唯一依据。
      ;(renderer as unknown as { clearPendingVisibility?: (id: string) => void })
        ?.clearPendingVisibility?.(key)
      // hasLayer 防御：mock/测试 renderer 可能无此方法（无则视为未创建 → 走 create）
      if (typeof renderer.hasLayer === 'function' && renderer.hasLayer(key)) {
        // 实例已存在（如 setupLayers/register 已 create）→ 强制同步可见性，
        // 防实例 visible=false 与 registry true 脱节（waterSurface 走 adapter 分派）
        if (adapter.setVisibility) {
          adapter.setVisibility(renderer, key, true)
        } else {
          renderer.setVisibility(key, true)
        }
        logger.debug(`[BusinessLayerManager] reapplyAll ${key} 已存在，同步可见性`)
        continue
      }
      logger.debug(
        `[BusinessLayerManager] reapplyAll ${key} → create（layerType=${meta.layerType}）`
      )
      try {
        const createOptions = {
          ...meta.options,
          // 失败 → 回滚状态 + toast（用户再按一次重试，不做自动重试）
          onError: () => this._handleCreateFailure(key, meta.label),
        }
        const result = adapter.create(renderer, key, meta.data, createOptions)
        // async create（Cesium geojson）rejection 兜底：同步 try/catch 抓不到
        Promise.resolve(result).catch(() => this._handleCreateFailure(key, meta.label))
      } catch (e) {
        // 单层失败不拖垮整批（引擎切换时其它图层仍应上屏）
        logger.warn(`[BusinessLayerManager] reapplyAll 重绘图层 ${key} 失败（已跳过该层）:`, e)
      }
    }
  }

  /**
   * 设置显隐
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

    const adapter = this._getAdapter(meta.layerType)
    if (!adapter) return

    // b058: 打开未创建的图层 → 先补建。register(visible:false) 不 create（BLM.register
    // 判据 `visible && data != null`），_layers 无该图层 → 直接 setVisibility 落入
    // _pendingVisibility 永不生效（无后续 create 触发 _applyPendingVisibility）→ 面板
    // 打开变"死按钮"。与 a040 updateData 补建同款语义：打开 + 有数据 + 未创建 → create。
    if (visible && meta.data != null && !renderer.hasLayer(key)) {
      const createOptions = {
        ...meta.options,
        // 失败 → 回滚状态 + toast（用户再按一次重试）
        onError: () => this._handleCreateFailure(key, meta.label),
      }
      const result = adapter.create(renderer, key, meta.data, createOptions)
      // async create（Cesium geojson）rejection 兜底
      Promise.resolve(result).catch(() => this._handleCreateFailure(key, meta.label))
    }

    // P0-4: 特殊图层（waterSurface 存于 _waterSurfaces 而非 _layers）经 adapter 分派,
    // 其余走 renderer.setVisibility 显隐（不销毁图层,数据保留, toggle 回来直接可见）
    if (adapter?.setVisibility) {
      adapter.setVisibility(renderer, key, visible)
    } else {
      renderer.setVisibility(key, visible)
    }
  }

  /**
   * 移除业务图层
   * 从 renderer 和 layerCatalog 同时移除。
   */
  remove(key: string): void {
    const meta = this._registry.get(key)
    if (meta) {
      const adapter = this._getAdapter(meta.layerType)
      if (adapter) {
        const renderer = this._getRenderer()
        if (renderer) {
          // adapter.remove 失败不中断 registry 删除——否则图层残留在 registry，
          // 引擎/路由切换时 reapplyAll 会把 A 页图层重绘到 B 页（"3D 数据加载到 2D"）
          try {
            perfTimeFn(`layer:remove:${meta.layerType}`, () => adapter.remove(renderer, key))
          } catch (e) {
            logger.warn(`[BusinessLayerManager] remove ${key} 渲染器清理失败（继续删 registry）:`, e)
          }
        }
      }
      this._registry.delete(key)
    }

    this._mapStore?.removeLayer(key)
  }

  /**
   * 从指定 renderer 移除所有业务图层的视觉实例（不删除 registry 条目）。
   * 用于 2D↔3D 引擎切换：UnifiedMap 的 OL/Cesium 渲染器实例长期复用、不销毁，
   * 业务图层会在两个渲染器上都留下视觉实例。切换时必须把「停用(old)」与
   * 「将启用(new)」渲染器上的实例清空，只保留 reapplyAll 按 registry 重绘的图层，
   * 否则：
   * - 孤儿图层（如洪涝页 dem-hillshade GeoTIFF）跨页残留，切回该引擎时被渲染，
   * 抛 "Rendering array data is not yet supported" 崩掉整个渲染循环；
   * - reapplyAll 对同 key 再次 add 会叠加重复图层。
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

  /**
   * 图层真实可见性（2026-08-08 按钮状态统一）：读渲染器实例状态（isLayerVisible），
   * 无渲染器/实例时退回 registry 意图。LayerControlPanel 按钮蓝/白以此为权威源——
   * 按钮蓝 = 图层真的在显示，杜绝"意图 true 但实例未创建"的状态脱节。
   */
  isLayerVisible(key: string): boolean {
    const meta = this._registry.get(key)
    if (!meta) return false
    const renderer = this._getRenderer()
    const rendererWithQuery = renderer as (MapRenderer & {
      isLayerVisible?: (id: string) => boolean
    }) | null
    if (rendererWithQuery && typeof rendererWithQuery.isLayerVisible === 'function') {
      return rendererWithQuery.isLayerVisible(key)
    }
    return meta.visible
  }

  /** 销毁管理器，清理所有业务图层 */
  destroy(): void {
    this.removeAll()
    this._registry.clear()
    this._mapStore = null
  }
}

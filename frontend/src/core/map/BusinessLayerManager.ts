/**
 * 业务图层生命周期管理器（BLM）：注册/更新/显隐/移除业务图层，
 * 分派到 layerAdapters 适配器执行实际渲染。状态存于本类 registry（权威源），
 * 并同步 mapStore.layerCatalog（图层目录，供 LayerControlPanel 展示）。
 * 关键约束：不持有 renderer 引用（动态取自 mapStore）、catalog 只存元数据、updateData 不覆盖 visible。
 */

import { perfTimeFn } from '@/shared'
import { logger } from '@/shared'
import type { EngineName, LayerEntry, LayerOptions, MapRenderer } from '@/types'
import { ENGINE_NAMES } from '@/types'
import type { LayerType } from '@/types/core/layerManager'

import { LAYER_ADAPTERS } from './layerAdapters'

/** 图层渲染失败事件载荷（manager 只上报，UI 层决定如何展示） */
export interface LayerErrorPayload {
  key: string
  label: string
}

/** mapStore 最小接口（仅声明实际使用的方法） */
interface MapStoreLike {
  currentRenderer: MapRenderer | null
  layerCatalog: LayerEntry[]
  registerBusinessLayer(
    key: string,
    label: string,
    layerType: LayerType,
    visible: boolean,
    engines?: EngineName[],
    listed?: boolean,
    locked?: boolean
  ): void
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
  /** 适用引擎（缺省双引擎通用；不适用引擎在 reapplyAll 跳过创建） */
  engines?: EngineName[]
  /** 是否在图层面板列出（缺省 true；false = 登记但不呈现，见 LayerEntry.listed） */
  listed?: boolean
  /** 可见性是否锁定（缺省 false；true = setVisible(false) 被拒，见 LayerEntry.locked） */
  locked?: boolean
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
  /** 适用引擎（缺省双引擎通用） */
  engines?: EngineName[]
  options: LayerOptions
  data: unknown
  /** 图层可见性（以本 registry 为唯一权威源——引擎切换时图层目录会被清空，故不依赖它） */
  visible: boolean
  /** 是否在图层面板列出（缺省 true）——引擎切换后 reapplyAll 重建目录条目须原样带上 */
  listed?: boolean
  /** 可见性是否锁定（缺省 false）——引擎切换后重建同样须带上，否则锁在切换后失效 */
  locked?: boolean
}

export class BusinessLayerManager {
  private _mapStore: MapStoreLike | null
  private _registry: Map<string, RegistryEntry>
  /** 图层错误回调（单监听方用回调注入即可，无需事件总线） */
  private _errorHandler: ((payload: LayerErrorPayload) => void) | null = null

  constructor(mapStore: MapStoreLike) {
    this._mapStore = mapStore
    this._registry = new Map()
  }

  /** 注册图层错误回调（UI 层注入 toast） */
  setErrorHandler(handler: (payload: LayerErrorPayload) => void): void {
    this._errorHandler = handler
  }

  /** 获取当前活跃的 renderer（动态，不缓存） */
  private _getRenderer(): MapRenderer | null {
    return this._mapStore?.currentRenderer ?? null
  }

  /** create 失败统一处理：回滚 registry/图层目录可见性、清待定显隐意图并上报错误回调。
   * 不自动重试——visible 是唯一状态，失败回滚后按钮灰即真实未显示。
   * err 为底层失败原因（形状守卫 message / Cesium 加载失败），落 warn 留痕——
   * 生产侧不能只有文案没有原因（04-D1/D2）。 */
  private _handleCreateFailure(key: string, label: string, err?: unknown): void {
    const meta = this._registry.get(key)
    if (meta) {
      meta.visible = false
      this._mapStore?.setLayerVisible(key, false)
    }
    // 清待定可见性（防过期意图残留导致下次 create 时错误应用）
    const renderer = this._getRenderer() as
      | (MapRenderer & { clearPendingVisibility?: (id: string) => void })
      | null
    renderer?.clearPendingVisibility?.(key)
    if (err !== undefined) {
      logger.warn(`[BusinessLayerManager] 图层 ${key}（${label}）创建失败:`, err)
    }
    this._errorHandler?.({ key, label })
  }

  /**
   * create 统一包装：同步抛错（layerAdapters 数据形状守卫）也必须走
   * _handleCreateFailure 回滚+上报——旧实现 create 在 try 外，抛错后
   * registry/catalog 停在 visible=true ⇒ 面板亮、屏幕上无、零提示，
   * 且每次引擎切换 reapplyAll 重复抛一次（缺陷自我固化）。
   * rethrow=false 用于 reapplyAll：单层失败不拖垮整批（引擎切换时其它图层仍应上屏）。
   * 默认回滚后继续上抛，保留既有「形状错误抛给调用方」的契约。
   */
  private _runCreate(
    renderer: MapRenderer,
    key: string,
    label: string,
    layerType: LayerType,
    data: unknown,
    options: LayerOptions,
    rethrow = true
  ): void {
    const adapter = this._getAdapter(layerType)
    if (!adapter) return
    const createOptions = {
      ...options,
      // 契约 onError?: (err: unknown) => void——实参必须透传，
      // 旧实现 `onError: () =>` 零参丢弃 ⇒ 生产失败只有文案无原因
      onError: (err: unknown) => this._handleCreateFailure(key, label, err),
    }
    let result: unknown
    try {
      result = perfTimeFn(`layer:create:${layerType}`, () =>
        adapter.create(renderer, key, data, createOptions)
      )
    } catch (e) {
      this._handleCreateFailure(key, label, e)
      if (rethrow) throw e
      return
    }
    // async create（Cesium geojson）rejection 兜底：同步 try/catch 抓不到
    Promise.resolve(result).catch((e) => this._handleCreateFailure(key, label, e))
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

  /** 注册新业务图层 */
  register(
    key: string,
    {
      label,
      layerType,
      data,
      options = {},
      visible = true,
      engines = LAYER_ADAPTERS[layerType]?.engines ?? [],
      listed = true,
      locked = false,
    }: LayerDescriptor
  ): void {
    if (this._registry.has(key)) {
      logger.debug(`[BusinessLayerManager] 图层 ${key} 已注册，请使用 updateData 更新数据`)
      return
    }

    const adapter = this._getAdapter(layerType)
    if (!adapter) return

    // 保存元数据（可见性存 registry，不依赖 catalog —— 引擎切换时 catalog 会被清空）
    this._registry.set(key, { label, layerType, options, data, visible, engines, listed, locked })

    // 注册到 layerCatalog（只存元数据，不存 renderer 对象）
    this._mapStore?.registerBusinessLayer(key, label, layerType, visible, engines, listed, locked)

    // 如果可见且有数据，立即渲染
    if (visible && data != null) {
      const renderer = this._getRenderer()
      logger.debug(
        `[BusinessLayerManager] register ${key}: visible=${visible} data=${data != null} renderer=${!!renderer}`
      )
      if (renderer) {
        // 数据形状守卫同步抛错（测试依赖）；Cesium geojson 的 create 为异步且失败不抛
        // rejection，必须注入 onError 感知失败 → 回滚状态 + toast。
        // _runCreate 统一处理同步抛错与异步 rejection 两条失败通道
        this._runCreate(renderer, key, label, layerType, data, options)
      }
    } else {
      logger.debug(
        `[BusinessLayerManager] register ${key} 暂不渲染: visible=${visible} data=${data != null}`
      )
    }
  }

  /** 更新图层数据：不改变 visible；可见时立即重建图层，不可见只缓存数据 */
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

    // data 为 null（清空意图）不触碰渲染器——数据形状守卫会抛错，
    // 图层实例保留旧数据是"等新数据"的合理中间态，创建/更新由后续 updateData 触发
    if (meta.data == null) {
      return
    }

    // 可见 → 更新图层
    const renderer = this._getRenderer()
    if (renderer) {
      // 图层实例缺失时补建（注册时 data 为 null 跳过 create、数据后到的场景），
      // 否则 adapter.update 因无 entry 失败、图层永不上屏
      if (meta.data != null && !renderer.hasLayer(key)) {
        // _runCreate 统一同步抛错 + 异步 rejection 两条失败通道
        this._runCreate(renderer, key, meta.label, meta.layerType, meta.data, meta.options)
      } else {
        // update 同步抛错同样回滚+上报后继续上抛（旧实现该调用不在 try 内）
        let r: unknown
        try {
          r = perfTimeFn(`layer:update:${meta.layerType}`, () =>
            adapter.update(renderer, key, meta.data, meta.options)
          )
        } catch (e) {
          this._handleCreateFailure(key, meta.label, e)
          throw e
        }
        Promise.resolve(r).catch((e) => this._handleCreateFailure(key, meta.label, e))
      }
    }
  }

  /**
   * 将 registry 中已注册且可见的业务图层重绘到指定 renderer（2D↔3D 引擎切换后使用）。
   * 依据：registry 是 App 级持久状态，引擎切换时图层目录会被清空，
   * 故重建视觉实例与目录条目都以 registry 为准（幂等）；单层失败只 warn 继续。
   */
  /** 显式对账入口（语义化包装 reapplyAll）：引擎切换、路由恢复、面板批量操作前调用，
   * 以 registry 为唯一权威把渲染器实际状态拉齐——图层状态统一收口于此 */
  reconcileWithRenderer(renderer: MapRenderer | null = this._getRenderer()): void {
    this.reapplyAll(renderer)
  }

  reapplyAll(renderer: MapRenderer | null = this._getRenderer()): void {
    if (!renderer) return
    logger.debug(
      `[BusinessLayerManager] reapplyAll 开始: renderer=${renderer.getType?.() ?? 'unknown'} registry=${this._registry.size}个图层`
    )
    for (const [key, meta] of this._registry.entries()) {
      // 目录条目重建先于 data==null 判断：data 未就绪的图层（如 API 返回后才渲染的
      // 淹没范围）也必须保留面板开关；条目重建只依赖 registry 元数据
      const catalog = this._mapStore?.layerCatalog ?? []
      if (!catalog.some((e: LayerEntry) => e.key === key)) {
        this._mapStore?.registerBusinessLayer(
          key,
          meta.label,
          meta.layerType,
          meta.visible,
          undefined,
          meta.listed,
          meta.locked
        )
      }
      if (meta.data == null) {
        logger.debug(`[BusinessLayerManager] reapplyAll ${key} 跳过（data 未就绪）`)
        continue
      }
      if (!meta.visible) {
        logger.debug(`[BusinessLayerManager] reapplyAll ${key} 跳过（visible=false）`)
        continue
      }
      // 引擎适用性过滤（engines 缺省视为双引擎通用）：不适用当前引擎的图层不创建，
      // 面板条目保留由上方重建；显隐恢复由适用引擎的 reapplyAll 接管
      {
        const rt = renderer.getType?.()
        const engineName: EngineName | null =
          rt === '2d' ? ENGINE_NAMES.OPENLAYERS : rt === '3d' ? ENGINE_NAMES.CESIUM : null
        if (engineName && meta.engines && !meta.engines.includes(engineName)) {
          logger.debug(`[BusinessLayerManager] reapplyAll ${key} 跳过（引擎 ${engineName} 不适用）`)
          continue
        }
      }
      const adapter = this._getAdapter(meta.layerType)
      if (!adapter)
        continue
        // 重建前清待定显隐意图，防止旧意图覆盖 registry 状态（按钮蓝但图层不显示）
      ;(
        renderer as unknown as { clearPendingVisibility?: (id: string) => void }
      )?.clearPendingVisibility?.(key)
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
      // rethrow=false：单层失败只回滚该层并继续批处理（引擎切换时其它图层仍应上屏）。
      // 旧实现 catch 只 warn 不回滚 ⇒ 该层 registry/catalog 停在已开、屏幕永无
      this._runCreate(renderer, key, meta.label, meta.layerType, meta.data, meta.options, false)
    }
  }

  /** 设置图层显隐（LayerControlPanel 入口，不直接操作 renderer） */
  setVisible(key: string, visible: boolean): void {
    const meta = this._registry.get(key)
    if (!meta) {
      logger.debug(`[BusinessLayerManager] 图层 ${key} 不在 registry 中`)
      return
    }

    // 锁定层拒绝关闭：该层是底图固有部分（如地形山影），关掉只会让地图变半成品。
    // 拒绝而非静默——调用方若因此走了"以为关掉了"的分支，这里留痕可查。
    // ⚠ 只在「关」的方向拒绝：开是真值状态，允许（幂等，用于引擎切换后重新拉齐）。
    if (meta.locked && !visible) {
      logger.debug(`[BusinessLayerManager] 图层 ${key} 可见性已锁定，忽略关闭请求`)
      return
    }

    // 先更新 registry 可见性（reapplyAll 的数据源），再更新 catalog（UI 展示）
    meta.visible = visible
    this._mapStore?.setLayerVisible(key, visible)
    const renderer = this._getRenderer()
    if (!renderer) return

    const adapter = this._getAdapter(meta.layerType)
    if (!adapter) return

    // 打开未创建的图层需先补建：register(visible:false) 时不渲染，若直接 setVisibility
    // 会落入待定显隐队列永不生效（无后续 create 触发应用），面板开关变"死按钮"
    if (visible && meta.data != null && !renderer.hasLayer(key)) {
      // _runCreate 统一同步抛错 + 异步 rejection 两条失败通道
      this._runCreate(renderer, key, meta.label, meta.layerType, meta.data, meta.options)
    }

    // 特殊图层（waterSurface 不存于普通图层表）经 adapter 分派显隐；
    // 其余走 renderer.setVisibility（不销毁图层，数据保留，再开直接可见）
    if (adapter?.setVisibility) {
      adapter.setVisibility(renderer, key, visible)
    } else {
      renderer.setVisibility(key, visible)
    }
  }

  /** 移除业务图层（renderer 与图层目录同步移除） */
  remove(key: string): void {
    const meta = this._registry.get(key)
    if (meta) {
      const adapter = this._getAdapter(meta.layerType)
      if (adapter) {
        const renderer = this._getRenderer()
        if (renderer) {
          // adapter.remove 失败不中断 registry 删除，否则残留条目会在
          // 引擎/路由切换时把 A 页图层重绘到 B 页
          try {
            perfTimeFn(`layer:remove:${meta.layerType}`, () => adapter.remove(renderer, key))
          } catch (e) {
            logger.warn(
              `[BusinessLayerManager] remove ${key} 渲染器清理失败（继续删 registry）:`,
              e
            )
          }
        }
      }
      this._registry.delete(key)
    }

    this._mapStore?.removeLayer(key)
  }

  /**
   * 从指定 renderer 移除所有业务图层的视觉实例（保留 registry）。
   * 双引擎的渲染器实例长期复用，切换引擎时清空两边的视觉实例，防止孤儿图层
   * （跨页残留、渲染报错）与重复叠加；只负责 registry 内条目，杜绝新孤儿产生。
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

  /** 图层真实可见性：优先读渲染器实例状态，无渲染器/实例时退回 registry 意图（按钮蓝 = 图层真的在显示） */
  isLayerVisible(key: string): boolean {
    const meta = this._registry.get(key)
    if (!meta) return false
    const renderer = this._getRenderer()
    const rendererWithQuery = renderer as
      | (MapRenderer & {
          isLayerVisible?: (id: string) => boolean
        })
      | null
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

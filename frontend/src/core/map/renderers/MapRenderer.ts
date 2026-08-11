import type { FeatureCollection } from 'geojson'

import { logger } from '@/shared'
import type {
  CameraState,
  FlyToOptions,
  FlyToTarget,
  LayerOptions,
  MapRendererEventMap,
  PointFeature,
  PolygonFeature,
  RendererState,
} from '@/types'

/** 图层状态（_layers Map 的值类型） */
interface LayerState {
  instance: unknown
  visible: boolean
  options?: LayerOptions
}

/** flyTo 目标归一化后的联合类型 */
type NormalizedFlyToTarget =
  | { lng: number; lat: number }
  | { layerId: string; [key: string]: unknown }

/** MapRenderer 抽象基类：双引擎策略模式——OL（2D）与 Cesium（3D）子类实现抽象方法，业务层仅依赖本接口（@/types） */
export class MapRenderer {
  container: HTMLElement
  _layers: Map<string, LayerState>
  _eventBus: EventTarget
  _pendingVisibility: Map<string, boolean>

  constructor(container: HTMLElement) {
    if (new.target === MapRenderer) {
      throw new Error('MapRenderer是抽象类，不能直接实例化')
    }
    this.container = container
    this._layers = new Map()
    this._eventBus = new EventTarget()
    this._pendingVisibility = new Map()
  }

  updateSize(): void {
    throw new Error(`${this.getType()} updateSize 未实现`)
  }

  getMap(): unknown {
    logger.debug(`${this.getType()} getMap 未实现（仅 2D 渲染器支持）`)
    return null
  }

  getViewer(): unknown {
    logger.debug(`${this.getType()} getViewer 未实现（仅 3D 渲染器支持）`)
    return null
  }

  addPointLayer(_id: string, _features: PointFeature[], _options: LayerOptions = {}): void {
    throw new Error(`${this.getType()} addPointLayer 未实现`)
  }

  addPolygonLayer(_id: string, _features: PolygonFeature[], _options: LayerOptions = {}): void {
    throw new Error(`${this.getType()} addPolygonLayer 未实现`)
  }

  addGeoJsonLayer(_id: string, _geojson: FeatureCollection, _options: LayerOptions = {}): void {
    throw new Error(`${this.getType()} addGeoJsonLayer 未实现`)
  }

  // GeoTIFF/热力图等收敛为可选能力接口（GeoTIFFCapability/HeatmapCapability）：基类不再声明，
  // 调用方（layerAdapters）经类型守卫（typeof 检查）确认支持后调用，避免 2D/3D 互背契约（同水面 Water3DCapability 模式）

  setVisibility(id: string, visible: boolean): void {
    const layer = this._layers.get(id)
    if (layer) {
      layer.visible = visible
      this._doSetVisibility(id, visible)
    } else {
      this._pendingVisibility.set(id, visible)
    }
  }

  _applyPendingVisibility(id: string): void {
    if (this._pendingVisibility.has(id)) {
      this.setVisibility(id, this._pendingVisibility.get(id) as boolean)
      this._pendingVisibility.delete(id)
    }
  }

  /** 清除某图层的待定可见性：create 失败后调用，防止过期意图（业务图层管理器 BLM 已回滚 visible）在下次 create 时被错误应用 */
  clearPendingVisibility(id: string): void {
    this._pendingVisibility.delete(id)
  }

  removeLayer(id: string): void {
    // 无论图层实例是否存在都清除待定可见性：pending 记录的是过期意图，否则同 id 重新注册
    // （如 visible:true）会被旧值（如 false）覆盖，导致面板与地图失步
    this._pendingVisibility.delete(id)
    const layer = this._layers.get(id)
    if (!layer) return

    this._doRemoveLayer(layer)
    this._layers.delete(id)
  }

  /** 图层是否已存在（公开方法，替代业务层直读私有 _layers，如 UnifiedMap.vue 重复添加检查） */
  hasLayer(id: string): boolean {
    return this._layers.has(id)
  }

  /** 图层真实可见性：读 _layers 实例的 visible，作为面板按钮状态的权威源（与 hasLayer 的区别：后者只问实例存在） */
  isLayerVisible(id: string): boolean {
    const layer = this._layers.get(id)
    return layer ? layer.visible : false
  }

  flyTo(target: FlyToTarget, options: FlyToOptions = {}): void {
    const normalizedTarget = this._normalizeFlyToTarget(target)
    if (!normalizedTarget) {
      throw new Error(`${this.getType()} flyTo 目标格式不支持`)
    }
    this._doFlyTo(normalizedTarget, options)
  }

  _normalizeFlyToTarget(target: unknown): NormalizedFlyToTarget | null {
    if (Array.isArray(target) && target.length === 2) {
      return { lng: target[0] as number, lat: target[1] as number }
    }
    if (typeof target === 'object' && target !== null && 'lng' in target && 'lat' in target) {
      const t = target as { lng: number; lat: number }
      return { lng: t.lng, lat: t.lat }
    }
    if (typeof target === 'string') {
      return { layerId: target }
    }
    if (typeof target === 'object' && target !== null && 'layerId' in target) {
      return target as { layerId: string; [key: string]: unknown }
    }
    return null
  }

  // 事件系统：泛型重载保证已知事件的类型安全，string 重载兼容自定义事件（如测试中的 'hover'）
  on<K extends keyof MapRendererEventMap>(
    event: K,
    handler: (event: CustomEvent<MapRendererEventMap[K]>) => void
  ): void
  on(event: string, handler: EventListenerOrEventListenerObject): void
  // 实现签名用 unknown：兼容泛型 handler (CustomEvent<T>)=>void 与 EventListener 的参数逆变，体内窄化后交给 EventTarget

  on(event: string, handler: unknown): void {
    this._eventBus.addEventListener(event, handler as EventListener)
  }

  off<K extends keyof MapRendererEventMap>(
    event: K,
    handler: (event: CustomEvent<MapRendererEventMap[K]>) => void
  ): void
  off(event: string, handler: EventListenerOrEventListenerObject): void

  off(event: string, handler: unknown): void {
    this._eventBus.removeEventListener(event, handler as EventListener)
  }

  emit<K extends keyof MapRendererEventMap>(event: K, data: MapRendererEventMap[K]): void
  emit(event: string, data: unknown): void
  emit(event: string, data: unknown): void {
    this._eventBus.dispatchEvent(new CustomEvent(event, { detail: data }))
  }

  exportState(): RendererState {
    const state: RendererState = {}
    for (const [id, layer] of this._layers) {
      state[id] = { visible: layer.visible }
    }
    const camera = this._getCameraState()
    if (camera) {
      state._camera = camera
    }
    return state
  }

  importState(state: RendererState): void {
    const camera = state._camera as CameraState | undefined

    for (const [id, cfg] of Object.entries(state)) {
      if (id === '_camera') continue
      if (cfg && typeof cfg === 'object' && 'visible' in cfg) {
        this.setVisibility(id, cfg.visible)
      }
    }

    if (camera) {
      this._setCameraState(camera)
    }
  }

  getType(): string {
    return 'base'
  }

  destroy(): void {
    this._layers.forEach((layer) => this._doRemoveLayer(layer))
    this._layers.clear()
    this._pendingVisibility.clear()
    this._eventBus = new EventTarget()
  }

  _doSetVisibility(_id: string, _visible: boolean): void {
    throw new Error('_doSetVisibility 未实现')
  }

  _doRemoveLayer(_layer: LayerState): void {
    throw new Error('_doRemoveLayer 未实现')
  }

  _doFlyTo(_target: NormalizedFlyToTarget, _options: FlyToOptions): void {
    throw new Error('_doFlyTo 未实现')
  }

  _getCameraState(): CameraState | null {
    return null
  }

  _setCameraState(_state: CameraState): void {}

  // 水面为 3D 专有能力（Water3DCapability）：基类不声明，避免为 2D 引擎背负 3D 契约（ISP 违反）；调用方做能力检查后调用

  // 呼吸动画：双引擎公共能力（OL 矢量圈 / Cesium 实体动画），子类各自实现，返回类型统一 void
  startBreathing(_lng: number, _lat: number): void {
    logger.debug(`${this.getType()} startBreathing 未实现`)
  }

  stopBreathing(): void {
    logger.debug(`${this.getType()} stopBreathing 未实现`)
  }

  // 底图切换：双引擎公共能力（OL 图层显隐 / Cesium imagery 显隐），子类各自实现（W4-10 入接口）
  setBaseLayer(_type: 'image' | 'vector'): void {
    logger.debug(`${this.getType()} setBaseLayer 未实现`)
  }
}

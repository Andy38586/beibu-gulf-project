import type { FeatureCollection } from 'geojson'

import type {
  CameraState,
  FlyToOptions,
  FlyToTarget,
  LayerOptions,
  MapRendererEventMap,
  PointFeature,
  PolygonFeature,
  RendererState,
  WaterSurfaceOptions,
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

/**
 * MapRenderer 抽象基类
 *
 * 双引擎策略模式的基类：OpenLayers（2D）与 Cesium（3D）子类各自实现抽象方法。
 * 业务层通过 MapRenderer 接口（@/types）操作地图，不直接依赖 OL 或 Cesium API。
 */
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

  async init(): Promise<void> {
    throw new Error(`${this.getType()} init 未实现`)
  }

  updateSize(): void {
    throw new Error(`${this.getType()} updateSize 未实现`)
  }

  getMap(): unknown {
    if (import.meta.env.DEV) {
      console.warn(`${this.getType()} getMap 未实现（仅 2D 渲染器支持）`)
    }
    return null
  }

  getViewer(): unknown {
    if (import.meta.env.DEV) {
      console.warn(`${this.getType()} getViewer 未实现（仅 3D 渲染器支持）`)
    }
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

  // 原设计文档使用 addGeoJsonLayer({type:'heatmap'})，但现有接口不支持
  // 正确做法：独立方法，子类按需实现
  addHeatmapLayer(_id: string, _features: PointFeature[], _options: LayerOptions = {}): boolean {
    if (import.meta.env.DEV) {
      console.warn(`${this.getType()} addHeatmapLayer 未实现（仅 2D 渲染器支持）`)
    }
    return false
  }

  updateHeatmapLayer(_id: string, _features: PointFeature[], _options: LayerOptions = {}): boolean {
    if (import.meta.env.DEV) {
      console.warn(`${this.getType()} updateHeatmapLayer 未实现`)
    }
    return false
  }

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

  removeLayer(id: string): void {
    const layer = this._layers.get(id)
    if (!layer) return

    this._doRemoveLayer(layer)
    this._layers.delete(id)
  }

  /**
   * 检查图层是否已存在
   *
   * 公开方法，替代业务层直读 `this._layers.has(id)` 私有属性
   * （如 UnifiedMap.vue 中 boundary/ports 重复添加检查）。
   */
  hasLayer(id: string): boolean {
    return this._layers.has(id)
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
  // 实现签名：泛型 handler (event: CustomEvent<...>) => void 与 EventListener 参数逆变不兼容，
  // 用 any 绕过重载兼容性检查（运行时 EventTarget 能正确分发 CustomEvent 到 handler）

  on(event: string, handler: any): void {
    this._eventBus.addEventListener(event, handler)
  }

  off<K extends keyof MapRendererEventMap>(
    event: K,
    handler: (event: CustomEvent<MapRendererEventMap[K]>) => void
  ): void
  off(event: string, handler: EventListenerOrEventListenerObject): void

  off(event: string, handler: any): void {
    this._eventBus.removeEventListener(event, handler)
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
    delete state._camera

    for (const [id, cfg] of Object.entries(state)) {
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

  // 3D Only 方法（子类按需覆盖）
  addWaterSurface(
    _id: string,
    _coordinates: [number, number][],
    _height: number = 0,
    _options: WaterSurfaceOptions = {}
  ): boolean {
    if (import.meta.env.DEV) {
      console.warn(`${this.getType()} addWaterSurface 未实现（仅 3D 渲染器支持）`)
    }
    return false
  }

  updateWaterLevel(_id: string, _newHeight: number): boolean {
    if (import.meta.env.DEV) {
      console.warn(`${this.getType()} updateWaterLevel 未实现（仅 3D 渲染器支持）`)
    }
    return false
  }

  removeWaterSurface(_id: string): boolean {
    if (import.meta.env.DEV) {
      console.warn(`${this.getType()} removeWaterSurface 未实现（仅 3D 渲染器支持）`)
    }
    return false
  }

  removeAllWaterSurfaces(): boolean {
    if (import.meta.env.DEV) {
      console.warn(`${this.getType()} removeAllWaterSurfaces 未实现（仅 3D 渲染器支持）`)
    }
    return false
  }

  setWaterSurfaceVisibility(_id: string, _visible: boolean): boolean {
    if (import.meta.env.DEV) {
      console.warn(`${this.getType()} setWaterSurfaceVisibility 未实现（仅 3D 渲染器支持）`)
    }
    return false
  }

  startBreathing(_lng: number, _lat: number): boolean {
    if (import.meta.env.DEV) {
      console.warn(`${this.getType()} startBreathing 未实现（仅 3D 渲染器支持）`)
    }
    return false
  }

  stopBreathing(): boolean {
    if (import.meta.env.DEV) {
      console.warn(`${this.getType()} stopBreathing 未实现（仅 3D 渲染器支持）`)
    }
    return false
  }
}

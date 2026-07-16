export class MapRenderer {
  constructor(container) {
    if (new.target === MapRenderer) {
      throw new Error('MapRenderer是抽象类，不能直接实例化')
    }
    this.container = container
    this._layers = new Map()
    this._eventBus = new EventTarget()
    this._pendingVisibility = new Map()
  }

  async init() {
    throw new Error(`${this.getType()} init 未实现`)
  }

  addPointLayer(_id, _features, _options = {}) {
    throw new Error(`${this.getType()} addPointLayer 未实现`)
  }

  addPolygonLayer(_id, _features, _options = {}) {
    throw new Error(`${this.getType()} addPolygonLayer 未实现`)
  }

  addGeoJsonLayer(_id, _geojson, _options = {}) {
    throw new Error(`${this.getType()} addGeoJsonLayer 未实现`)
  }

  setVisibility(id, visible) {
    const layer = this._layers.get(id)
    if (layer) {
      layer.visible = visible
      this._doSetVisibility(id, visible)
    } else {
      this._pendingVisibility.set(id, visible)
    }
  }

  _applyPendingVisibility(id) {
    if (this._pendingVisibility.has(id)) {
      this.setVisibility(id, this._pendingVisibility.get(id))
      this._pendingVisibility.delete(id)
    }
  }

  removeLayer(id) {
    const layer = this._layers.get(id)
    if (!layer) return

    this._doRemoveLayer(layer)
    this._layers.delete(id)
  }

  flyTo(target, options = {}) {
    const normalizedTarget = this._normalizeFlyToTarget(target)
    if (!normalizedTarget) {
      throw new Error(`${this.getType()} flyTo 目标格式不支持`)
    }
    this._doFlyTo(normalizedTarget, options)
  }

  _normalizeFlyToTarget(target) {
    if (Array.isArray(target) && target.length === 2) {
      return { lng: target[0], lat: target[1] }
    }
    if (typeof target === 'object' && target.lng !== undefined && target.lat !== undefined) {
      return { lng: target.lng, lat: target.lat }
    }
    if (typeof target === 'string') {
      return { layerId: target }
    }
    if (typeof target === 'object' && target.layerId) {
      return target
    }
    return null
  }

  on(event, handler) {
    this._eventBus.addEventListener(event, handler)
  }

  off(event, handler) {
    this._eventBus.removeEventListener(event, handler)
  }

  emit(event, data) {
    this._eventBus.dispatchEvent(new CustomEvent(event, { detail: data }))
  }

  exportState() {
    const state = {}
    for (const [id, layer] of this._layers) {
      state[id] = { visible: layer.visible }
    }
    const camera = this._getCameraState()
    if (camera) {
      state._camera = camera
    }
    return state
  }

  importState(state) {
    const camera = state._camera
    delete state._camera

    for (const [id, cfg] of Object.entries(state)) {
      this.setVisibility(id, cfg.visible)
    }

    if (camera) {
      this._setCameraState(camera)
    }
  }

  getType() {
    return 'base'
  }

  destroy() {
    this._layers.forEach((layer) => this._doRemoveLayer(layer))
    this._layers.clear()
    this._pendingVisibility.clear()
    this._eventBus = new EventTarget()
  }

  _doSetVisibility(_id, _visible) {
    throw new Error('_doSetVisibility 未实现')
  }

  _doRemoveLayer(_layer) {
    throw new Error('_doRemoveLayer 未实现')
  }

  _doFlyTo(_target, _options) {
    throw new Error('_doFlyTo 未实现')
  }

  _getCameraState() {
    return null
  }

  _setCameraState(_state) {}
}

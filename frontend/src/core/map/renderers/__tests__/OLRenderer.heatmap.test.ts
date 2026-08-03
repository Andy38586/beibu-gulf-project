/**
 * OLRenderer 热力图回归测试（P0-1）
 *
 * 验证 addHeatmapLayer / updateHeatmapLayer 在收到 GeoJSON Feature 数组时
 * 不再因 `normalizePoint(coordinates[])` 数组解构抛 `TypeError: object is not iterable`。
 * 修复：改为直接取数组元素 coords?.[0] / coords?.[1]。
 *
 * 沿用 OLRenderer.culling.test.ts 的 mock 策略：mock ol/Map 与 ol/View（无需真实 DOM 渲染）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ==================== Mock ol/Map 与 ol/View ====================
const moveendListeners: Array<{ type: string; listener: (...args: unknown[]) => void }> = []

interface FakeViewOptions {
  center?: [number, number]
  zoom?: number
}

interface FakeMapOptions {
  target?: unknown
  view?: FakeView
}

interface FakeHeatmapOptions {
  source?: unknown
}

class FakeView {
  _extent: [number, number, number, number] = [0, 0, 0, 0]
  _center: [number, number] = [0, 0]
  _zoom = 9

  constructor(options: FakeViewOptions = {}) {
    if (options?.center) this._center = options.center
    if (options?.zoom != null) this._zoom = options.zoom
  }

  setExtent(extent: [number, number, number, number]) {
    this._extent = extent
  }

  calculateExtent(_size?: number[]): [number, number, number, number] {
    return this._extent
  }

  getCenter() {
    return this._center
  }

  getZoom() {
    return this._zoom
  }

  animate() {}
  fit() {}
}

class FakeMap {
  target: unknown
  view: FakeView
  layers: unknown[] = []
  listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map()
  disposed = false

  constructor(options: FakeMapOptions = {}) {
    this.target = options.target
    this.view = options.view || new FakeView()
  }

  on(type: string, listener: (...args: unknown[]) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
    const key = { type, listener }
    if (type === 'moveend') moveendListeners.push(key)
    return key
  }

  un(type: string, listener: (...args: unknown[]) => void) {
    this.listeners.get(type)?.delete(listener)
    const idx = moveendListeners.findIndex((k) => k.type === type && k.listener === listener)
    if (idx !== -1) moveendListeners.splice(idx, 1)
  }

  trigger(type: string, event?: unknown) {
    this.listeners.get(type)?.forEach((fn) => fn(event))
  }

  getView() {
    return this.view
  }

  getSize() {
    return [800, 600]
  }

  addLayer(layer: unknown) {
    this.layers.push(layer)
  }

  removeLayer(layer: unknown) {
    this.layers = this.layers.filter((l) => l !== layer)
  }

  forEachFeatureAtPixel() {}

  dispose() {
    this.disposed = true
  }
}

// ol/layer/Heatmap 在构造时调用 createGradient → canvas.getContext('2d').createLinearGradient，
// jsdom 无 canvas 实现会返回 null 而抛错。mock 掉，仅保留 addHeatmapLayer 用到的接口。
class FakeHeatmap {
  source: unknown
  _props: Record<string, unknown>
  _visible: boolean

  constructor(options: FakeHeatmapOptions = {}) {
    this.source = options.source
    this._props = {}
    this._visible = true
  }
  set(key: string, val: unknown) {
    this._props[key] = val
  }
  get(key: string) {
    return this._props[key]
  }
  getSource() {
    return this.source
  }
  setVisible(v: boolean) {
    this._visible = v
  }
  dispose() {}
}

vi.mock('ol/Map', () => ({ default: FakeMap }))
vi.mock('ol/View', () => ({ default: FakeView }))
vi.mock('ol/layer/Heatmap', () => ({ default: FakeHeatmap }))

// OLRenderer 必须在 mock 注册后动态导入
const { OLRenderer } = await import('../OLRenderer')

// ==================== 测试数据 ====================
function makeHeatFeatures(n: number) {
  const arr: Array<{
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: { value: number }
  }> = []
  for (let i = 0; i < n; i++) {
    arr.push({
      geometry: { type: 'Point', coordinates: [108.5 + i * 0.001, 21.7 + i * 0.001] },
      properties: { value: i + 1 },
    })
  }
  return arr
}

// ==================== 测试 ====================
interface OLHeatFeatureLike {
  getGeometry(): { getCoordinates(): [number, number]; getType(): string }
  get(key: string): unknown
}
interface OLHeatSourceLike {
  getFeatures(): OLHeatFeatureLike[]
}
interface OLHeatLayerInstanceLike {
  getSource(): OLHeatSourceLike
}

/**
 * 白盒测试访问类型：OLRenderer.ts 带 @ts-nocheck，运行时成员 map
 * 未声明在类型中，需显式暴露供 afterEach 检查 disposed 状态。
 */
type OLRendererTestAccess = InstanceType<typeof OLRenderer> & {
  map: unknown
}

describe('OLRenderer 热力图（P0-1）', () => {
  let renderer: OLRendererTestAccess | undefined
  let container: HTMLElement

  beforeEach(() => {
    moveendListeners.length = 0
    container = document.createElement('div')
    renderer = new OLRenderer(container) as unknown as OLRendererTestAccess
  })

  afterEach(() => {
    if (renderer?.map && !(renderer.map as { disposed: boolean }).disposed) {
      renderer.destroy()
    }
  })

  describe('addHeatmapLayer', () => {
    it('用例A：传入 GeoJSON Feature 数组不抛错，图层注册成功', () => {
      const features = makeHeatFeatures(3)
      expect(() => renderer!.addHeatmapLayer('heat', features, {})).not.toThrow()
      expect(renderer!._layers.get('heat')).toBeTruthy()
    })

    it('用例C：coordinates 缺失时回退 (0,0) 不抛错', () => {
      const features = [{ geometry: {}, properties: { value: 1 } }]
      expect(() => renderer!.addHeatmapLayer('heat-empty', features, {})).not.toThrow()
      expect(renderer!._layers.get('heat-empty')).toBeTruthy()
    })

    it('坐标正确写入要素（lng/lat 取自数组）', () => {
      const features = makeHeatFeatures(1)
      renderer!.addHeatmapLayer('heat-1', features, {})
      const source = (
        renderer!._layers.get('heat-1')!.instance as OLHeatLayerInstanceLike
      ).getSource()
      const [feature] = source.getFeatures()
      const geom = feature.getGeometry()
      const [x, y] = geom.getCoordinates()
      expect(geom.getType()).toBe('Point')
      // 直接校验要素存在且 properties.value 透传
      expect(feature.get('value')).toBe(1)
      expect(Number.isFinite(x)).toBe(true)
      expect(Number.isFinite(y)).toBe(true)
    })
  })

  describe('updateHeatmapLayer', () => {
    it('用例B：更新后 source 要素数等于新数据长度', () => {
      const initial = makeHeatFeatures(2)
      renderer!.addHeatmapLayer('heat-upd', initial, {})
      const updated = makeHeatFeatures(5)
      expect(() => renderer!.updateHeatmapLayer('heat-upd', updated, {})).not.toThrow()
      const source = (
        renderer!._layers.get('heat-upd')!.instance as OLHeatLayerInstanceLike
      ).getSource()
      expect(source.getFeatures()).toHaveLength(5)
    })

    it('更新不存在的图层安全返回 false', () => {
      expect(renderer!.updateHeatmapLayer('nope', makeHeatFeatures(1), {})).toBe(false)
    })
  })
})

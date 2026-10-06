/**
 * OLRenderer 视口裁剪集成测试
 * 覆盖行为：addPointLayer 阈值路由 → 视口内要素渲染 → moveend 增量刷新（只观测挂到 Map 上的
 * 图层 source 与事件监听数，不读渲染器私有账本）
 * 策略：
 * - mock ol/Map 与 ol/View（渲染层需真实 DOM，裁剪逻辑与渲染无关）
 * - 其余 OL 类（Feature/Point/VectorSource/Style）与 rbush 空间索引用真实实现
 * - 断言聚焦：索引构建、视口查询、source 内容替换、moveend 增量更新、监听生命周期
 */
import { fromLonLat } from 'ol/proj'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { VIEWPORT_CULL_THRESHOLD } from '@/shared'

// threads 池下 ol/source/GeoTIFF 依赖的 web-worker 在嵌套 worker 环境崩溃
// （workerData undefined）；本测试不覆盖 GeoTIFF 图层，mock 掉避免模块加载失败。
// 注意：此 mock 曾被 git checkout 覆盖（2026-08-07），若 threads 下该文件 0 test 失败先检查。
vi.mock('ol/source/GeoTIFF', () => ({ default: class GeoTIFFMock {} }))

// ==================== Mock ol/Map 与 ol/View ====================
const moveendListeners: Array<{ type: string; listener: (...args: unknown[]) => void }> = []

/**
 * 引入的常驻 camera-changed moveend 监听基线数。
 * OLRenderer 构造时即注册 `_cameraChangedKey = map.on('moveend', ...)`（防抖回传相机状态），
 * 故未启用裁剪时 moveendListeners=1；启用裁剪后 moveendListeners=2（camera-changed + 裁剪）。
 * 本测试聚焦裁剪监听生命周期，故用 BASE 常量表达"裁剪相关 moveend 数 = 总数 - BASE"。
 */
const CAMERA_MOVEEND_BASE = 1

interface FakeViewOptions {
  center?: [number, number]
  zoom?: number
}

interface FakeMapOptions {
  target?: unknown
  view?: FakeView
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

vi.mock('ol/Map', () => ({ default: FakeMap }))
vi.mock('ol/View', () => ({ default: FakeView }))

// OLRenderer 必须在 mock 注册后动态导入
const { OLRenderer } = await import('../OLRenderer')

// ==================== 测试数据构造 ====================
/** 钦州港区域（视口内）锚点 */
const QINZHOU: [number, number] = [108.62, 21.858]
/** 防城港区域（视口外）锚点 */
const FANGCHENG: [number, number] = [108.35, 21.62]

/** 生成 n 个围绕锚点的小范围随机点，返回归一化点要素 */
function makePoints(anchor: [number, number], n: number, prefix: string) {
  const points = []
  for (let i = 0; i < n; i++) {
    points.push({
      id: `${prefix}-${i}`,
      lng: anchor[0] + (Math.random() - 0.5) * 0.01,
      lat: anchor[1] + (Math.random() - 0.5) * 0.01,
      name: `${prefix}-point-${i}`,
    })
  }
  return points
}

/** 构造包住锚点的视口 extent（3857），半径约 10km */
function extentAround(anchor: [number, number]): [number, number, number, number] {
  const [x, y] = fromLonLat(anchor)
  return [x - 10000, y - 10000, x + 10000, y + 10000]
}

/** 从 source 读取已渲染要素 id 集合 */
interface OLCullFeatureLike {
  get(key: string): unknown
}
interface OLCullSourceLike {
  getFeatures(): OLCullFeatureLike[]
  clear(): void
}
interface OLCullLayerLike {
  getSource(): OLCullSourceLike
}

function sourceFeatureIds(source: OLCullSourceLike): Set<string> {
  return new Set(source.getFeatures().map((f) => f.get('id') as string))
}

// ==================== 测试 ====================
describe('OLRenderer 视口裁剪集成', () => {
  let renderer: InstanceType<typeof OLRenderer> | undefined
  let container: HTMLElement
  /** 构造器已挂底图 TileLayer；此后 addLayer 的增量层从这里开始 */
  let layerBaseline = 0
  /** 超过阈值的点数，保证 addPointLayer 走裁剪路径 */
  const N = VIEWPORT_CULL_THRESHOLD + 10

  beforeEach(() => {
    moveendListeners.length = 0
    container = document.createElement('div')
    renderer = new OLRenderer(container)
    layerBaseline = (renderer.getMap() as unknown as FakeMap).layers.length
    // 将视图范围初始化为钦州港区域
    map().getView().setExtent(extentAround(QINZHOU))
  })

  afterEach(() => {
    if (renderer?.getMap() && !map().disposed) {
      renderer.destroy()
    }
  })

  function map(): FakeMap {
    return renderer!.getMap() as unknown as FakeMap
  }

  /** 第 index 个新增图层的 source（观测渲染器与地图引擎的公开协作面，不读 _cullLayers） */
  function renderedSource(index = 0): OLCullSourceLike {
    return (map().layers[layerBaseline + index] as OLCullLayerLike).getSource()
  }

  describe('阈值路由（VIEWPORT_CULL_THRESHOLD=1000）', () => {
    it('超过阈值走裁剪路径：构建 R-tree 索引并注册 moveend 监听', () => {
      const features = makePoints(QINZHOU, N, 'qz')
      renderer!.addPointLayer('culled', features, {})

      expect(renderer!.hasLayer('culled')).toBe(true)
      expect(moveendListeners).toHaveLength(1 + CAMERA_MOVEEND_BASE)
    })

    it('未超阈值走普通路径：不建索引、不注册 moveend 监听', () => {
      const features = makePoints(QINZHOU, 10, 'small')
      renderer!.addPointLayer('plain', features, {})

      expect(renderedSource().getFeatures()).toHaveLength(10)
      expect(moveendListeners).toHaveLength(0 + CAMERA_MOVEEND_BASE)
    })
  })

  describe('初始加载只渲染视口内要素', () => {
    it('视口内要素渲染，视口外要素被裁剪', () => {
      const inView = makePoints(QINZHOU, N, 'in')
      const outView = makePoints(FANGCHENG, 5, 'out')
      renderer!.addPointLayer('mixed', [...inView, ...outView], {})

      const ids = sourceFeatureIds(renderedSource())

      expect(ids.size).toBe(N)
      expect([...ids].every((id) => String(id).startsWith('in'))).toBe(true)
      expect([...ids].every((id) => !String(id).startsWith('out'))).toBe(true)
    })

    it('要素 properties 透传（featureType + 原始字段）', () => {
      const features = makePoints(QINZHOU, N, 'prop')
      renderer!.addPointLayer('props', features, { featureType: 'poi' })

      const [feature] = renderedSource().getFeatures()
      expect(feature.get('featureType')).toBe('poi')
      expect(feature.get('name')).toMatch(/^prop-point-\d+$/)
    })
  })

  describe('moveend 增量刷新', () => {
    it('视口移动后 source 内容替换为新视口要素', () => {
      const qinzhou = makePoints(QINZHOU, N, 'qz')
      const fangcheng = makePoints(FANGCHENG, N, 'fc')
      renderer!.addPointLayer('move', [...qinzhou, ...fangcheng], {})

      // 初始视口在钦州港 → 只渲染 qz 点
      let ids = sourceFeatureIds(renderedSource())
      expect(ids.size).toBe(N)
      expect([...ids].every((id) => String(id).startsWith('qz'))).toBe(true)

      // 移动视口到防城港并触发 moveend → 只渲染 fc 点
      map().getView().setExtent(extentAround(FANGCHENG))
      map().trigger('moveend')
      ids = sourceFeatureIds(renderedSource())

      expect(ids.size).toBe(N)
      expect([...ids].every((id) => String(id).startsWith('fc'))).toBe(true)
      expect([...ids].every((id) => !String(id).startsWith('qz'))).toBe(true)
    })

    it('moveend 监听只注册一次（多图层共享）', () => {
      renderer!.addPointLayer('a', makePoints(QINZHOU, N, 'a'), {})
      renderer!.addPointLayer('b', makePoints(QINZHOU, N, 'b'), {})
      renderer!.addPointLayer('c', makePoints(QINZHOU, N, 'c'), {})

      expect(moveendListeners).toHaveLength(1 + CAMERA_MOVEEND_BASE)
    })

    it('moveend 事件刷新全部裁剪图层', () => {
      renderer!.addPointLayer('m1', makePoints(QINZHOU, N, 'm1'), {})
      renderer!.addPointLayer('m2', makePoints(QINZHOU, N + 7, 'm2'), {})

      // 移出所有要素区域 → 两个 source 都被 moveend 刷新为空
      map()
        .getView()
        .setExtent(extentAround([121.0, 31.0]))
      map().trigger('moveend')
      expect(renderedSource(0).getFeatures()).toHaveLength(0)
      expect(renderedSource(1).getFeatures()).toHaveLength(0)

      // 移回钦州港 → 两个 source 按各自数据量重新填充
      map().getView().setExtent(extentAround(QINZHOU))
      map().trigger('moveend')
      expect(renderedSource(0).getFeatures()).toHaveLength(N)
      expect(renderedSource(1).getFeatures()).toHaveLength(N + 7)
    })
  })

  describe('监听生命周期（removeLayer / destroy）', () => {
    it('移除唯一裁剪图层后 moveend 监听被解除', () => {
      renderer!.addPointLayer('solo', makePoints(QINZHOU, N, 'solo'), {})
      expect(moveendListeners).toHaveLength(1 + CAMERA_MOVEEND_BASE)

      renderer!.removeLayer('solo')
      expect(renderer!.hasLayer('solo')).toBe(false)
      expect(moveendListeners).toHaveLength(0 + CAMERA_MOVEEND_BASE)
    })

    it('存在多个裁剪图层时移除一个不解除监听', () => {
      renderer!.addPointLayer('k1', makePoints(QINZHOU, N, 'k1'), {})
      renderer!.addPointLayer('k2', makePoints(QINZHOU, N, 'k2'), {})

      renderer!.removeLayer('k1')
      expect(moveendListeners).toHaveLength(1 + CAMERA_MOVEEND_BASE)

      renderer!.removeLayer('k2')
      expect(moveendListeners).toHaveLength(0 + CAMERA_MOVEEND_BASE)
    })

    it('destroy 清理全部裁剪图层与监听', () => {
      renderer!.addPointLayer('d1', makePoints(QINZHOU, N, 'd1'), {})
      renderer!.addPointLayer('d2', makePoints(QINZHOU, N, 'd2'), {})
      expect(moveendListeners).toHaveLength(1 + CAMERA_MOVEEND_BASE)
      const fakeMap = map()

      renderer!.destroy()
      expect(moveendListeners).toHaveLength(0)
      expect(fakeMap.disposed).toBe(true)
    })
  })

  describe('空视口/空图层边界', () => {
    it('空要素数组不抛错', () => {
      expect(() => renderer!.addPointLayer('empty', [], {})).not.toThrow()
    })

    it('移动视口到无要素区域后 source 为空', () => {
      renderer!.addPointLayer('far', makePoints(QINZHOU, N, 'far'), {})

      // 视口移动到远离任何点的位置（上海附近）
      map()
        .getView()
        .setExtent(extentAround([121.0, 31.0]))
      map().trigger('moveend')

      expect(renderedSource().getFeatures()).toHaveLength(0)
    })
  })
})

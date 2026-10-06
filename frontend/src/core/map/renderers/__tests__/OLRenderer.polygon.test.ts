/**
 * OLRenderer 多边形契约回归测试：
 * 1. 内环（孔洞）：geometry.type='Polygon' 的环组 [外环,...内环] 必须全量进 OL 几何
 *    （丢内环会把 2D 孔洞填实，与 3D Cesium 遍历 holes 的视觉分裂）；
 * 2. MultiPolygon 部件独立性：部件 2..N 是独立多边形，绝不能落进第 1 部件的环组
 *    （OL Polygon 把 ring[1..] 当孔洞——部件会被错误挖空）；
 * 3. 无类型元数据的裸 coordinates 取首环（与 CesiumRenderer 同口径，不猜孔洞）；
 * 4. add 幂等：重复 add 同 id 先移除旧图层，map 上无孤儿（与 Cesium 对齐）。
 * 沿用 OLRenderer.culling/heatmap 测试的 mock 策略：mock ol/Map 与 ol/View。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// threads 池下 ol/source/GeoTIFF 依赖的 web-worker 在嵌套 worker 环境崩溃，mock 掉
vi.mock('ol/source/GeoTIFF', () => ({ default: class GeoTIFFMock {} }))

// ==================== Mock ol/Map 与 ol/View（对齐 OLRenderer.heatmap.test.ts） ====================
class FakeView {
  animate() {}
  fit() {}
  getCenter() {
    return [0, 0]
  }
  getZoom() {
    return 9
  }
  on() {}
  setCenter() {}
  setExtent() {}
  setZoom() {}
}

class FakeMap {
  layers: unknown[] = []

  addLayer(layer: unknown) {
    this.layers.push(layer)
  }

  removeLayer(layer: unknown) {
    this.layers = this.layers.filter((l) => l !== layer)
  }

  getView() {
    return new FakeView()
  }

  getSize() {
    return [800, 600]
  }

  on() {
    return {}
  }
  un() {}
  dispose() {}
}

vi.mock('ol/Map', () => ({ default: FakeMap }))
vi.mock('ol/View', () => ({ default: FakeView }))

const { OLRenderer } = await import('../OLRenderer')

interface OlGeomLike {
  getType(): string
  getCoordinates(): unknown
}

interface OlFeatureLike {
  getGeometry(): OlGeomLike
}

interface OlSourceLike {
  getFeatures(): OlFeatureLike[]
}

interface OlLayerLike {
  getSource(): OlSourceLike
}

const OUTER = [
  [108.6, 21.8],
  [108.7, 21.8],
  [108.7, 21.9],
  [108.6, 21.8],
]
const HOLE = [
  [108.63, 21.83],
  [108.66, 21.83],
  [108.66, 21.86],
  [108.63, 21.83],
]
const PART2 = [
  [108.8, 21.8],
  [108.9, 21.8],
  [108.9, 21.9],
  [108.8, 21.8],
]

/** 渲染器最后挂到 OL Map 上的图层 source（观测公开协作面，不读 _layers） */
function lastLayer(renderer: InstanceType<typeof OLRenderer>): OlLayerLike {
  const map = renderer.getMap() as unknown as FakeMap
  return map.layers[map.layers.length - 1] as OlLayerLike
}

function firstGeom(renderer: InstanceType<typeof OLRenderer>) {
  const [feature] = lastLayer(renderer).getSource().getFeatures()
  return feature?.getGeometry()
}

function featureCount(renderer: InstanceType<typeof OLRenderer>) {
  return lastLayer(renderer).getSource().getFeatures().length
}

describe('OLRenderer 多边形契约（内环/部件/幂等）', () => {
  let renderer: InstanceType<typeof OLRenderer>
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    renderer = new OLRenderer(container)
  })

  afterEach(() => {
    renderer.destroy()
  })

  it("geometry.type='Polygon' 环组 → 内环保留（环数=2）", () => {
    renderer.addPolygonLayer(
      'poly-holes',
      [
        {
          geometry: { type: 'Polygon', coordinates: [OUTER, HOLE] },
          properties: {},
        },
      ],
      {}
    )
    const geom = firstGeom(renderer)
    expect(geom).toBeDefined()
    expect(geom.getType()).toBe('Polygon')
    expect(geom.getCoordinates()).toHaveLength(2) // [外环, 内环]——丢内环=填实孔洞
  })

  it('无类型裸 coordinates（环组）→ 取首环外环，不猜孔洞（Cesium 同口径）', () => {
    renderer.addPolygonLayer(
      'poly-notype',
      [
        {
          coordinates: [OUTER, HOLE] as unknown as never,
          properties: {},
        },
      ],
      {}
    )
    const geom = firstGeom(renderer)
    expect(geom).toBeDefined()
    expect(geom.getType()).toBe('Polygon')
    expect(geom.getCoordinates()).toHaveLength(1) // 仅外环
  })

  it('无类型平面单环（点数组非环组）→ 要素跳过（Cesium createPolygon 同口径拒绝）', () => {
    renderer.addPolygonLayer(
      'poly-flat',
      [{ coordinates: OUTER as unknown as never, properties: {} }],
      {}
    )
    expect(featureCount(renderer)).toBe(0)
  })

  it('MultiPolygon 双部件 → ol MultiPolygon 且部件数=2（部件不互为孔洞）', () => {
    renderer.addPolygonLayer(
      'multi-2parts',
      [
        {
          geometry: {
            type: 'MultiPolygon',
            coordinates: [[OUTER, HOLE], [PART2]],
          },
          properties: {},
        },
      ],
      {}
    )
    const geom = firstGeom(renderer)
    expect(geom).toBeDefined()
    expect(geom.getType()).toBe('MultiPolygon')
    const polys = geom.getCoordinates() as unknown as unknown[][][]
    expect(polys).toHaveLength(2) // 第 2 部件是独立多边形，不是第 1 部件的孔洞
    expect(polys[0]).toHaveLength(2) // 第 1 部件自带内环
    expect(polys[1]).toHaveLength(1)
  })

  it('add 幂等：重复 add 同 id 先移除旧图层，map 无孤儿（与 Cesium 对齐）', () => {
    const mk = () => [
      {
        geometry: { type: 'Polygon', coordinates: [OUTER] },
        properties: {},
      },
    ]
    const map = renderer.getMap() as unknown as FakeMap
    const baseline = map.layers.length // 构造器已挂底图 TileLayer，以增量计
    renderer.addPolygonLayer('poly-idem', mk(), {})
    renderer.addPolygonLayer('poly-idem', mk(), {}) // 重复 add 同 id
    expect(map.layers.length).toBe(baseline + 1) // 旧图层已被移除，仅存新图层
    expect(renderer.hasLayer('poly-idem')).toBe(true)
  })
})

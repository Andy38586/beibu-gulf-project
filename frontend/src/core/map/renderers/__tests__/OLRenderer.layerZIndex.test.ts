/**
 * OLRenderer 图层叠放层级（W50 / 根因 C）直测。
 *
 * 治的失效：`_resolveLayerZIndex` 原实现拿 `options.featureType` 去比
 * `'flood-area' | 'flood-facilities' | 'forecast-'*`——但那三个值里
 * 两个是**图层 key**（`LAYER_KEYS.floodFacilities`、`FORECAST_LAYER_PREFIX`），
 * 不是 featureType。三条判据里两条恒假，只有 `'flood-area'` 因两个命名空间
 * 恰好同名而“生效”。后果：受影响设施层与三张预测层全部落在普通业务层 10 档。
 *
 * 判据口径：观测**挂到 OL Map 上的真实图层**的 `getZIndex()`，不读渲染器私有账本
 * （与 OLRenderer.culling / OLRenderer.polygon 同策略）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// threads 池下 ol/source/GeoTIFF 依赖的 web-worker 在嵌套 worker 环境崩溃，mock 掉
vi.mock('ol/source/GeoTIFF', () => ({ default: class GeoTIFFMock {} }))

// ==================== Mock ol/Map 与 ol/View（对齐 culling/polygon 测试） ====================
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
const { LAYER_KEYS, forecastLayerId, LAYER_DEFAULTS } = await import('@/shared')

interface OlLayerLike {
  getZIndex(): number
}

/** 最后挂到 OL Map 上的图层（观测公开协作面） */
function lastLayer(renderer: InstanceType<typeof OLRenderer>): OlLayerLike {
  const map = renderer.getMap() as unknown as FakeMap
  return map.layers[map.layers.length - 1] as OlLayerLike
}

/** 测试统一走 addPointLayer：它是 `_resolveLayerZIndex` 的生产调用点之一 */
function addLayerWith(
  renderer: InstanceType<typeof OLRenderer>,
  id: string,
  options: Record<string, unknown> = {}
): number {
  renderer.addPointLayer(id, [], options as never)
  return lastLayer(renderer).getZIndex()
}

describe('OLRenderer 图层叠放层级 — 按图层 key 判定（W50 修复）', () => {
  let renderer: InstanceType<typeof OLRenderer>

  beforeEach(() => {
    renderer = new OLRenderer(document.createElement('div'))
  })

  afterEach(() => {
    renderer.destroy()
  })

  it('三个真实覆盖类生产者的 key 全部拿到覆盖档 15', () => {
    // 淹没范围 / 受影响设施：FloodAnalysisPage 的 FLOOD_LAYER_ID / FACILITY_LAYER_ID
    expect(addLayerWith(renderer, LAYER_KEYS.floodArea)).toBe(LAYER_DEFAULTS.zIndexCover)
    expect(addLayerWith(renderer, LAYER_KEYS.floodFacilities)).toBe(LAYER_DEFAULTS.zIndexCover)
    // 预测图层：key 由 forecastLayerId 派生
    expect(addLayerWith(renderer, forecastLayerId('cargo'))).toBe(LAYER_DEFAULTS.zIndexCover)
    expect(addLayerWith(renderer, forecastLayerId('activity'))).toBe(LAYER_DEFAULTS.zIndexCover)
    expect(addLayerWith(renderer, forecastLayerId('container'))).toBe(LAYER_DEFAULTS.zIndexCover)
  })

  it('普通业务层 key 一律落 10 档（阴性对照）', () => {
    for (const key of [LAYER_KEYS.boundary, LAYER_KEYS.ports, LAYER_KEYS.routePath]) {
      expect(addLayerWith(renderer, key), `key=${key} 不应拿覆盖档`).toBe(LAYER_DEFAULTS.zIndex)
    }
  })

  it('🔴 @guard-red-sample featureType 不得再影响层级（治 RC1 命名空间混用）', () => {
    // 这两个值在旧实现里会被当 key 去比；现在 key 不是覆盖类就必须落普通档，
    // 即便 featureType 长得像覆盖类也一样 —— 把 featureType 重新接回判据即红。
    const cases: Array<Record<string, unknown>> = [
      { featureType: 'flood-facility-point' },
      { featureType: LAYER_KEYS.floodFacilities },
      { featureType: forecastLayerId('cargo') },
      { featureType: 'flood-area' },
    ]
    for (const options of cases) {
      expect(
        addLayerWith(renderer, LAYER_KEYS.ports, options),
        `featureType=${String(options.featureType)} 不应把 ports 抬到覆盖档`
      ).toBe(LAYER_DEFAULTS.zIndex)
    }
  })

  it('显式 options.zIndex 优先于派生档（调用方覆盖权不被夺走）', () => {
    expect(addLayerWith(renderer, LAYER_KEYS.floodArea, { zIndex: 42 })).toBe(42)
    expect(addLayerWith(renderer, LAYER_KEYS.ports, { zIndex: 0 })).toBe(0)
  })
})

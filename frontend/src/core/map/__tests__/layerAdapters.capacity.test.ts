import { describe, expect, it, vi } from 'vitest'

import { LAYER_ADAPTERS } from '../layerAdapters'

/**
 * W46：要素上限守卫（layerAdapters.ts:60-101 的 assertPointArray / assertFeatureCollection /
 * assertPolygonArray）写了三族，但此前零测试。上限是同一个常量 500_000。
 *
 * 本套用例钉四件事：create 超限必抛、恰好上限不抛、update 路径同样受守卫、三族口径一致。
 */
const MAX = 500_000
const over = () => new Array(MAX + 1)
const exact = () => new Array(MAX)

function renderer() {
  return {
    getType: () => 'cesium',
    removeLayer: vi.fn(),
    addPointLayer: vi.fn(),
    addPolygonLayer: vi.fn(),
    addGeoJsonLayer: vi.fn(),
    addHeatmapLayer: vi.fn(),
  }
}

describe('要素上限守卫（50 万，三族同口径）', () => {
  it('🔴 points：超上限抛错', () => {
    expect(() =>
      LAYER_ADAPTERS.points.create(renderer() as never, 'p', over() as never, {} as never)
    ).toThrow(/要素数超上限/)
  })

  it('points：恰好上限不抛，正常下发', () => {
    const r = renderer()
    LAYER_ADAPTERS.points.create(r as never, 'p', exact() as never, {} as never)
    expect(r.addPointLayer).toHaveBeenCalledTimes(1)
  })

  it('🔴 heatmap：与 points 同一断言同一口径', () => {
    expect(() =>
      LAYER_ADAPTERS.heatmap.create(renderer() as never, 'h', over() as never, {} as never)
    ).toThrow(/要素数超上限/)
  })

  it('🔴 geojson：features 超限抛错', () => {
    expect(() =>
      LAYER_ADAPTERS.geojson.create(
        renderer() as never,
        'g',
        { type: 'FeatureCollection', features: over() } as never,
        {} as never
      )
    ).toThrow(/要素数超上限/)
  })

  it('🔴 polygon：超限抛错', () => {
    expect(() =>
      LAYER_ADAPTERS.polygon.create(renderer() as never, 'pg', over() as never, {} as never)
    ).toThrow(/要素数超上限/)
  })

  it('🔴 update 路径同样受守卫（不是只在 create 上）', () => {
    expect(() =>
      LAYER_ADAPTERS.points.update(renderer() as never, 'p', over() as never, {} as never)
    ).toThrow(/要素数超上限/)
  })
})

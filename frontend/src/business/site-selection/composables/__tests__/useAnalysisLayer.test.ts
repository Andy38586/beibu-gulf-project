import { describe, expect, it, vi } from 'vitest'
import type { Feature, FeatureCollection, Geometry } from 'geojson'

import type { BusinessLayerManager } from '@/core'
import type { AnalysisResult } from '@/types'

import {
  buildCoverageGeoJson,
  buildMatchedGeoJson,
  useAnalysisLayer,
} from '../useAnalysisLayer'

/**
 * useAnalysisLayer 单测（覆盖率方案①：业务 composable 抽测）
 *
 * 覆盖：
 * - buildCoverageGeoJson / buildMatchedGeoJson 纯函数（含非法坐标过滤）
 * - getAnalysisLayers 图层描述符组装
 * - createUpdateHandler 的 register/updateData 分支与并发排队（isUpdating/pendingResult）
 */

/** mock BusinessLayerManager 最小实现 */
function createMockManager() {
  return {
    has: vi.fn(() => false),
    register: vi.fn(),
    updateData: vi.fn(),
  } as unknown as BusinessLayerManager
}

describe('buildCoverageGeoJson', () => {
  it('null 输入返回空 FeatureCollection', () => {
    const result = buildCoverageGeoJson(null)
    expect(result.type).toBe('FeatureCollection')
    expect(result.features).toEqual([])
  })

  it('FeatureCollection 输入给每个 feature 打 featureType 标记', () => {
    const input: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
      ],
    }
    const result = buildCoverageGeoJson(input)
    expect(result.features[0].properties?.featureType).toBe('analysis-coverage')
  })

  it('单个 Feature 输入被包装为 FeatureCollection', () => {
    const input: Feature = {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [] },
      properties: { name: 'x' },
    }
    const result = buildCoverageGeoJson(input)
    expect(result.type).toBe('FeatureCollection')
    expect(result.features).toHaveLength(1)
    expect(result.features[0].properties?.featureType).toBe('analysis-coverage')
  })
})

describe('buildMatchedGeoJson', () => {
  it('空数组返回空 FeatureCollection', () => {
    const result = buildMatchedGeoJson([])
    expect(result.features).toEqual([])
  })

  it('合法小区映射为 Point Feature 并打 featureType 标记', () => {
    const result = buildMatchedGeoJson([
      { id: 'x1', name: '小区A', lng: 108.6, lat: 21.8, score: 90 },
    ] as never)
    expect(result.features).toHaveLength(1)
    const f = result.features[0]
    expect(f.geometry.type).toBe('Point')
    expect((f.geometry as Geometry & { coordinates: number[] }).coordinates).toEqual([108.6, 21.8])
    expect(f.properties?.featureType).toBe('analysis-matched')
    expect(f.properties?.name).toBe('小区A')
  })

  it('过滤缺坐标/类型非法/超范围的小区', () => {
    const result = buildMatchedGeoJson([
      { id: 'bad-missing', name: '缺坐标', score: 1 },
      { id: 'bad-type', name: '类型错', lng: '108', lat: 21, score: 1 },
      { id: 'bad-range', name: '超范围', lng: 999, lat: 21, score: 1 },
      { id: 'ok', name: '合法', lng: 108.6, lat: 21.8, score: 1 },
    ] as never)
    expect(result.features).toHaveLength(1)
    expect(result.features[0].properties?.id).toBe('ok')
  })
})

describe('useAnalysisLayer', () => {
  it('getAnalysisLayers: 有 coverage 与 matchedXiaoqu 时组装两个图层', () => {
    const { getAnalysisLayers } = useAnalysisLayer()
    const result: AnalysisResult = {
      error: null,
      coverage: { type: 'FeatureCollection', features: [] } as never,
      matchedXiaoqu: [{ id: 'x', name: 'x', lng: 1, lat: 1, score: 1 }] as never,
      facilityPoi: {},
    }
    const layers = getAnalysisLayers(result)
    expect(layers.map((l) => l.id)).toEqual(['analysis-coverage', 'analysis-matched'])
  })

  it('getAnalysisLayers: 无数据时返回空数组', () => {
    const { getAnalysisLayers } = useAnalysisLayer()
    const result: AnalysisResult = {
      error: null,
      coverage: null,
      matchedXiaoqu: [],
      facilityPoi: {},
    }
    expect(getAnalysisLayers(result)).toEqual([])
  })

  it('createUpdateHandler: 未注册图层走 register,已注册走 updateData', async () => {
    const { createUpdateHandler } = useAnalysisLayer()
    const manager = createMockManager()

    // 第一次 has 返回 false → register;之后 has 返回 true → updateData
    ;(manager.has as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(false)
      .mockReturnValue(true)

    const handler = createUpdateHandler(manager)
    await handler({
      error: null,
      coverage: { type: 'FeatureCollection', features: [] } as never,
      matchedXiaoqu: [] as never,
      facilityPoi: {},
    })

    expect(manager.register).toHaveBeenCalledTimes(1)
    expect(manager.register).toHaveBeenCalledWith(
      'analysis-coverage',
      expect.objectContaining({ layerType: 'geojson' })
    )
  })

  it('createUpdateHandler: 并发调用时排队最后结果（isUpdating/pendingResult）', async () => {
    const { createUpdateHandler } = useAnalysisLayer()
    const manager = createMockManager()
    const handler = createUpdateHandler(manager)

    // 让第一次 register 变慢,制造 in-flight 窗口
    let releaseFirst: () => void
    ;(manager.register as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
    )

    const p1 = handler({
      error: null,
      coverage: null,
      matchedXiaoqu: [{ id: 'a', name: 'a', lng: 1, lat: 1, score: 1 }] as never,
      facilityPoi: {},
    })
    // 第一次还在 in-flight,第二次调用被排队
    const p2 = handler({
      error: null,
      coverage: null,
      matchedXiaoqu: [{ id: 'b', name: 'b', lng: 2, lat: 2, score: 2 }] as never,
      facilityPoi: {},
    })

    releaseFirst!()
    await p1
    await p2

    // register 被调用两次（第一次直接 + 第二次排队后重放）
    expect(manager.register).toHaveBeenCalledTimes(2)
  })
})

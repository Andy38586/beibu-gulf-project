/**
 * 选址页 POI 图层孤儿复活回归测试（P0-4）
 *
 * 根因：clearAnalysisLayers 对设施 POI 图层绕过 businessLayerManager，直调
 * mapStore.removeLayer + renderer.removeLayer → _registry 中条目残留 →
 * 引擎切换时 App.vue reapplyAll 按 registry 重绘出已删图层（孤儿复活）。
 *
 * 修复：clearAnalysisLayers 改走 businessLayerManager.remove（内部已做
 * adapter.remove → _registry.delete → mapStore.removeLayer）。
 *
 * 本测试验证 manager.remove 的语义（这正是修复后 POI 清理所依赖的行为）：
 *   1. remove 后 has(key) === false；
 *   2. remove 后 mapStore.layerCatalog 无该条目；
 *   3. remove 后 reapplyAll 不会重建该 key（renderer 未被调用）。
 * 只要 clearAnalysisLayers 走 manager.remove，便不会在 registry 残留 → 不复活。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MapRenderer } from '@/types'

import { BusinessLayerManager } from '../BusinessLayerManager'

function createMockMapStore() {
  const catalog: any[] = []
  return {
    layerCatalog: catalog,
    currentRenderer: null as MapRenderer | null,
    registerBusinessLayer: vi.fn(
      (key: string, _label: string, _layerType: string, _visible: boolean) => {
        catalog.push({
          key,
          label: _label,
          layerType: _layerType,
          visible: _visible,
          category: 'business',
        })
      }
    ),
    removeLayer: vi.fn((key: string) => {
      const idx = catalog.findIndex((e) => e.key === key)
      if (idx >= 0) catalog.splice(idx, 1)
    }),
    setLayerVisible: vi.fn(),
  }
}

describe('P0-4 POI 图层孤儿复活 — manager.remove 语义', () => {
  let manager: BusinessLayerManager
  let mapStore: any

  beforeEach(() => {
    mapStore = createMockMapStore()
    manager = new BusinessLayerManager(mapStore)
  })

  it('remove 后 has(key) === false 且 catalog 无该条目', () => {
    manager.register('facility-poi-hospital', {
      label: '医院POI',
      layerType: 'points',
      data: [{ lng: 108, lat: 21 }],
      visible: true,
    })
    expect(manager.has('facility-poi-hospital')).toBe(true)
    expect(mapStore.layerCatalog.some((e: any) => e.key === 'facility-poi-hospital')).toBe(true)

    manager.remove('facility-poi-hospital')

    expect(manager.has('facility-poi-hospital')).toBe(false)
    expect(mapStore.layerCatalog.some((e: any) => e.key === 'facility-poi-hospital')).toBe(false)
  })

  it('remove 后 reapplyAll 不会重建该 key（renderer 未被调用）', () => {
    manager.register('facility-poi-hospital', {
      label: '医院POI',
      layerType: 'points',
      data: [{ lng: 108, lat: 21 }],
      visible: true,
    })
    // 引擎切换前先移除（等价于 clearAnalysisLayers 走 manager）
    manager.remove('facility-poi-hospital')

    // 模拟引擎切换：reapplyAll 传入新 renderer
    const newRenderer = { addPointLayer: vi.fn() }
    manager.reapplyAll(newRenderer as unknown as MapRenderer)

    expect(newRenderer.addPointLayer).not.toHaveBeenCalled()
    expect(newRenderer.addPointLayer).not.toHaveBeenCalledWith(
      'facility-poi-hospital',
      expect.anything(),
      expect.anything()
    )
  })

  it('未 remove 的图层在 reapplyAll 仍正常重绘（对照组，确认修复不影响正常流程）', () => {
    manager.register('facility-poi-keep', {
      label: '保留POI',
      layerType: 'points',
      data: [{ lng: 108, lat: 21 }],
      visible: true,
    })

    const newRenderer = { addPointLayer: vi.fn() }
    manager.reapplyAll(newRenderer as unknown as MapRenderer)

    expect(newRenderer.addPointLayer).toHaveBeenCalledWith(
      'facility-poi-keep',
      [{ lng: 108, lat: 21 }],
      {}
    )
  })
})

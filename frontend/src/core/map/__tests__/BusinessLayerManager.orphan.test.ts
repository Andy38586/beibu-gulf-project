/**
 * 选址页 POI 图层"孤儿复活"回归测试：图层若绕过 manager 直接删渲染器实例，
 * registry 条目残留，引擎切换时 reapplyAll 会把它重绘回来。
 * 本测试验证 manager.remove 的完整语义（删实例 + 删 registry + 删目录，且不复活）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MapRenderer } from '@/types'
import type { LayerType } from '@/types/core/layerManager'

import { BusinessLayerManager } from '../BusinessLayerManager'

/** mock catalog 条目 */
interface MockCatalogEntry {
  key: string
  label: string
  layerType: LayerType
  visible: boolean
  category: 'base' | 'business'
}

function createMockMapStore() {
  const catalog: MockCatalogEntry[] = []
  return {
    layerCatalog: catalog,
    currentRenderer: null as MapRenderer | null,
    registerBusinessLayer: vi.fn(
      (key: string, _label: string, _layerType: LayerType, _visible: boolean) => {
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
  let mapStore: ReturnType<typeof createMockMapStore>

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
    expect(
      mapStore.layerCatalog.some((e: MockCatalogEntry) => e.key === 'facility-poi-hospital')
    ).toBe(true)

    manager.remove('facility-poi-hospital')

    expect(manager.has('facility-poi-hospital')).toBe(false)
    expect(
      mapStore.layerCatalog.some((e: MockCatalogEntry) => e.key === 'facility-poi-hospital')
    ).toBe(false)
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
      // BLM create 注入 onError（失败回滚意图），options 不再为空
      expect.objectContaining({ onError: expect.any(Function) })
    )
  })
})

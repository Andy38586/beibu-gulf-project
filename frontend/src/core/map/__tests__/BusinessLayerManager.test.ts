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

/** mock mapStore — 仅 BusinessLayerManager 使用的方法 */
function createMockMapStore() {
  const catalog: MockCatalogEntry[] = []
  return {
    layerCatalog: catalog,
    currentRenderer: null as MapRenderer | null,
    registerBusinessLayer: vi.fn(
      (key: string, label: string, layerType: LayerType, visible: boolean) => {
        catalog.push({ key, label, layerType, visible, category: 'business' })
      }
    ),
    removeLayer: vi.fn((key: string) => {
      const idx = catalog.findIndex((e) => e.key === key)
      if (idx >= 0) catalog.splice(idx, 1)
    }),
    setLayerVisible: vi.fn((key: string, visible: boolean) => {
      const entry = catalog.find((e) => e.key === key)
      if (entry) entry.visible = visible
    }),
  }
}

/**
 * BusinessLayerManager 单测
 *
 * 实施计划 08「步骤 3 蓝图」对 setVisible 的断言（manager 应通过 mapStore.setLayerVisible 改可见性）
 * 与实际实现一致，予以保留。真实实现见 BusinessLayerManager.ts:
 *   - this._mapStore.setLayerVisible(key, visible)：经 Pinia action 改写 visible（DevTools 可追踪）
 *   - renderer.setVisibility(key, visible)：显隐图层但不销毁（数据仍保留在 renderer 内）
 * 本用例据此断言两者均被调用、且 catalog 条目的 visible 经 store action 更新。
 */
describe('BusinessLayerManager', () => {
  let manager: BusinessLayerManager

  let mapStore: any

  beforeEach(() => {
    mapStore = createMockMapStore()
    manager = new BusinessLayerManager(mapStore)
  })

  describe('register', () => {
    it('应注册图层到 catalog', () => {
      manager.register('test-layer', {
        label: '测试图层',
        layerType: 'points',
        data: [{ lng: 108, lat: 21 }],
        visible: true,
      })

      expect(mapStore.registerBusinessLayer).toHaveBeenCalledWith(
        'test-layer',
        '测试图层',
        'points',
        true
      )
      expect(manager.has('test-layer')).toBe(true)
    })

    it('未知 layerType 应不注册', () => {
      // 'unknown-type' 不在 LayerType 联合中，用 as 绕过编译期检查以测试运行时分支
      manager.register('bad-layer', {
        label: '错误图层',
        layerType: 'unknown-type' as LayerType,
        data: [],
      })

      expect(manager.has('bad-layer')).toBe(false)
    })

    it('重复注册应警告且只注册一次', () => {
      manager.register('dup-layer', {
        label: '重复',
        layerType: 'points',
        data: [],
        visible: true,
      })
      // 第二次注册同一 key
      manager.register('dup-layer', {
        label: '重复',
        layerType: 'points',
        data: [],
        visible: true,
      })
      // registerBusinessLayer 应只调用一次
      expect(mapStore.registerBusinessLayer).toHaveBeenCalledTimes(1)
    })
  })

  describe('setVisible', () => {
    it('应通过 mapStore.setLayerVisible + renderer.setVisibility 修改可见性', () => {
      // 注册时不依赖 renderer（currentRenderer 为 null）
      manager.register('vis-layer', {
        label: '可见性测试',
        layerType: 'points',
        data: [{ lng: 108, lat: 21 }],
        visible: true,
      })

      const renderer = { setVisibility: vi.fn() }
      mapStore.currentRenderer = renderer

      manager.setVisible('vis-layer', false)

      // 真实实现：经 Pinia action 改写 visible
      expect(mapStore.setLayerVisible).toHaveBeenCalledWith('vis-layer', false)
      // 同时调 renderer.setVisibility 显隐（不销毁图层）
      expect(renderer.setVisibility).toHaveBeenCalledWith('vis-layer', false)
      // catalog 条目 visible 被 store action 更新
      const entry = mapStore.layerCatalog.find((e: MockCatalogEntry) => e.key === 'vis-layer')
      expect(entry.visible).toBe(false)
    })
  })

  describe('remove', () => {
    it('应从 catalog 和 registry 移除', () => {
      manager.register('rm-layer', {
        label: '移除测试',
        layerType: 'points',
        data: [],
        visible: true,
      })
      expect(manager.has('rm-layer')).toBe(true)

      manager.remove('rm-layer')
      expect(manager.has('rm-layer')).toBe(false)
      expect(mapStore.removeLayer).toHaveBeenCalledWith('rm-layer')
    })
  })

  describe('reapplyAll', () => {
    it('引擎切换后应重绘可见图层', () => {
      manager.register('reapply-layer', {
        label: '重绘测试',
        layerType: 'points',
        data: [{ lng: 108, lat: 21 }],
        visible: true,
      })

      // 模拟引擎切换：传入新 renderer（points adapter → addPointLayer）
      const newRenderer = { addPointLayer: vi.fn() }
      manager.reapplyAll(newRenderer as unknown as MapRenderer)

      expect(newRenderer.addPointLayer).toHaveBeenCalled()
    })
  })
})

// mapStore 状态回归测试（地图状态链路）
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// mock localStorage
const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, v),
  removeItem: (k: string) => storage.delete(k),
})

// mock sessionStorage（b037 resetMapState 清除分析结果持久化）
const sessionStore = new Map<string, string>()
vi.stubGlobal('sessionStorage', {
  getItem: (k: string) => sessionStore.get(k) ?? null,
  setItem: (k: string, v: string) => sessionStore.set(k, v),
  removeItem: (k: string) => sessionStore.delete(k),
})

import { useMapStore } from '../mapStore'

describe('mapStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    storage.clear()
    sessionStore.clear()
  })

  describe('setMapType', () => {
    it('应切换地图类型', () => {
      const store = useMapStore()
      store.setMapType('3d')
      expect(store.mapType).toBe('3d')
    })

    it('应在 2d/3d 间正确切换', () => {
      const store = useMapStore()
      store.setMapType('3d')
      store.setMapType('2d')
      expect(store.mapType).toBe('2d')
    })
  })

  describe('registerLayer', () => {
    it('应注册新图层到 catalog', () => {
      const store = useMapStore()
      store.registerLayer('test-layer', '测试图层', {
        visible: true,
        category: 'business',
        show: [() => {}],
        hide: [() => {}],
      })
      expect(store.layerCatalog).toHaveLength(1)
      expect(store.layerCatalog[0].key).toBe('test-layer')
      expect(store.layerCatalog[0].label).toBe('测试图层')
      expect(store.layerCatalog[0].visible).toBe(true)
    })

    it('重复注册同 key 应替换回调而非追加', () => {
      const store = useMapStore()
      const show1 = vi.fn()
      const show2 = vi.fn()
      store.registerLayer('dup', 'A', { visible: true, show: [show1] })
      store.registerLayer('dup', 'B', { visible: false, show: [show2] })
      expect(store.layerCatalog).toHaveLength(1)
      expect(store.layerCatalog[0].label).toBe('A') // label 不更新
    })
  })

  describe('registerBusinessLayer', () => {
    it('应注册业务图层（无 show/hide 回调）', () => {
      const store = useMapStore()
      store.registerBusinessLayer('biz-1', '业务图层', 'geojson', true)
      const entry = store.layerCatalog.find((e) => e.key === 'biz-1')
      expect(entry).toBeDefined()
      expect(entry!.layerType).toBe('geojson')
      expect(entry!.visible).toBe(true)
      expect(entry!.show).toBeUndefined()
    })

    it('重复注册应更新 visible 和 layerType', () => {
      const store = useMapStore()
      store.registerBusinessLayer('biz-1', '业务图层', 'geojson', true)
      store.registerBusinessLayer('biz-1', '业务图层', 'points', false)
      const entry = store.layerCatalog.find((e) => e.key === 'biz-1')
      expect(entry!.layerType).toBe('points')
      expect(entry!.visible).toBe(false)
      expect(store.layerCatalog).toHaveLength(1)
    })
  })

  describe('toggleLayer', () => {
    it('应切换图层可见性并执行 show/hide 回调', () => {
      const store = useMapStore()
      const show = vi.fn()
      const hide = vi.fn()
      store.registerLayer('toggle-test', '切换测试', {
        visible: true,
        show: [show],
        hide: [hide],
      })

      store.toggleLayer('toggle-test')
      expect(store.layerCatalog[0].visible).toBe(false)
      expect(hide).toHaveBeenCalled()

      store.toggleLayer('toggle-test')
      expect(store.layerCatalog[0].visible).toBe(true)
      expect(show).toHaveBeenCalled()
    })

    it('不存在的 key 不应报错', () => {
      const store = useMapStore()
      expect(() => store.toggleLayer('nonexistent')).not.toThrow()
    })
  })

  describe('setCurrentRenderer', () => {
    it('应设置和清除渲染器引用', () => {
      const store = useMapStore()
      const mockRenderer = { getType: () => 'ol' }
      store.setCurrentRenderer(mockRenderer as never)
      expect(store.currentRenderer).toBe(mockRenderer)

      store.setCurrentRenderer(null)
      expect(store.currentRenderer).toBeNull()
    })
  })

  describe('registerAnalysisHandler / setAnalysisResult (LIF-4)', () => {
    it('回放抛出异常的 handler 不应抛出未捕获错误', () => {
      const store = useMapStore()
      const badHandler = () => {
        throw new Error('replay boom')
      }
      // 先写入 lastAnalysisResult 使 registerAnalysisHandler 触发同步回放
      store.setAnalysisResult({ foo: 'bar' })
      expect(() => store.registerAnalysisHandler(badHandler)).not.toThrow()
    })

    it('setAnalysisResult 调用抛出异常的 handler 不应抛出', () => {
      const store = useMapStore()
      const badHandler = () => {
        throw new Error('call boom')
      }
      store.registerAnalysisHandler(badHandler)
      expect(() => store.setAnalysisResult({ a: 1 })).not.toThrow()
    })
  })

  describe('resetMapState (b037)', () => {
    it('应清空 selectedPort/analysisHandler/lastAnalysisResult 与 sessionStorage，保留 mapType/baseLayerKey', () => {
      const store = useMapStore()
      // 准备：写入业务交互状态
      store.setSelectedPort({ id: 'p1', name: '测试港口' } as never)
      store.setMapType('3d')
      store.setAnalysisResult({ foo: 'bar' })
      store.registerAnalysisHandler(() => {})
      store.setActivePanel('port-info')
      // sessionStorage 应有持久化分析结果
      expect(sessionStore.size).toBeGreaterThan(0)

      store.resetMapState()

      // 清空项
      expect(store.selectedPort).toBeNull()
      expect(store.analysisHandler).toBeNull()
      expect(store.activePanel).toBe('none')
      // sessionStorage 已清除（lastAnalysisResult 持久化被移除）
      expect(sessionStore.size).toBe(0)
      // lastAnalysisResult 内部状态通过行为验证：reset 后注册新 handler 不应触发回放
      const replaySpy = vi.fn()
      store.registerAnalysisHandler(replaySpy)
      expect(replaySpy).not.toHaveBeenCalled()
      // 保留项（用户偏好）
      expect(store.mapType).toBe('3d')
    })

    it('应清空 layerCatalog 业务条目但保留 base 底图条目', () => {
      const store = useMapStore()
      store.registerLayer('base-image', '影像底图', {
        visible: true,
        category: 'base',
        show: [() => {}],
        hide: [() => {}],
      })
      store.registerBusinessLayer('biz-1', '业务图层', 'geojson', true)
      store.registerBusinessLayer('biz-2', '业务图层2', 'points', true)
      expect(store.layerCatalog).toHaveLength(3)

      store.resetMapState()

      expect(store.layerCatalog).toHaveLength(1)
      expect(store.layerCatalog[0].key).toBe('base-image')
      expect(store.layerCatalog[0].category).toBe('base')
    })
  })
})

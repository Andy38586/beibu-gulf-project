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

  describe('registerBusinessLayer', () => {
    it('应注册业务图层（仅元数据，P6 无 show/hide 回调字段）', () => {
      const store = useMapStore()
      store.registerBusinessLayer('biz-1', '业务图层', 'geojson', true)
      const entry = store.layerCatalog.find((e) => e.key === 'biz-1')
      expect(entry).toBeDefined()
      expect(entry!.layerType).toBe('geojson')
      expect(entry!.visible).toBe(true)
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

  describe('registerBaseLayer / setBaseLayer（P6 底图互斥）', () => {
    it('首个底图默认可见，setBaseLayer 切换互斥', () => {
      const store = useMapStore()
      store.registerBaseLayer('base-image', '影像底图')
      store.registerBaseLayer('base-vector', '矢量底图')
      // 默认第一个底图可见
      expect(store.layerCatalog.find((e) => e.key === 'base-image')!.visible).toBe(true)
      expect(store.layerCatalog.find((e) => e.key === 'base-vector')!.visible).toBe(false)

      store.setBaseLayer('base-vector')
      // 互斥：vector 可见、image 隐藏、baseLayerKey 更新
      expect(store.layerCatalog.find((e) => e.key === 'base-vector')!.visible).toBe(true)
      expect(store.layerCatalog.find((e) => e.key === 'base-image')!.visible).toBe(false)
      expect(store.baseLayerKey).toBe('base-vector')
    })

    it('重复 setBaseLayer 同 key 为 no-op（不重复渲染）', () => {
      const store = useMapStore()
      store.registerBaseLayer('base-image', '影像底图')
      store.setBaseLayer('base-image')
      expect(store.baseLayerKey).toBe('base-image')
      expect(store.layerCatalog.find((e) => e.key === 'base-image')!.visible).toBe(true)
    })

    it('不存在的 key 不应报错', () => {
      const store = useMapStore()
      expect(() => store.setBaseLayer('nonexistent')).not.toThrow()
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

  describe('setAnalysisResult（2026-08-08：store 只持久化，不再持有/调用分析回调）', () => {
    it('写入结果并更新 lastAnalysisResult 与 sessionStorage', () => {
      const store = useMapStore()
      expect(() => store.setAnalysisResult({ foo: 'bar' })).not.toThrow()
      expect(store.lastAnalysisResult).toEqual({ foo: 'bar' })
    })
  })

  describe('resetMapState (b037)', () => {
    it('应清空 selectedPort/lastAnalysisResult 与 sessionStorage，保留 mapType/baseLayerKey', () => {
      const store = useMapStore()
      // 准备：写入业务交互状态
      store.setSelectedPort({ id: 'p1', name: '测试港口' } as never)
      store.setMapType('3d')
      store.setAnalysisResult({ foo: 'bar' })
      // sessionStorage 应有持久化分析结果
      expect(sessionStore.size).toBeGreaterThan(0)

      store.resetMapState()

      // 清空项
      expect(store.selectedPort).toBeNull()
      expect(store.lastAnalysisResult).toBeNull()
      // sessionStorage 已清除（lastAnalysisResult 持久化被移除）
      expect(sessionStore.size).toBe(0)
      // 保留项（用户偏好）
      expect(store.mapType).toBe('3d')
    })

    it('应清空 layerCatalog 业务条目但保留 base 底图条目', () => {
      const store = useMapStore()
      store.registerBaseLayer('base-image', '影像底图')
      store.registerBusinessLayer('biz-1', '业务图层', 'geojson', true)
      store.registerBusinessLayer('biz-2', '业务图层2', 'points', true)
      expect(store.layerCatalog).toHaveLength(3)

      store.resetMapState()

      expect(store.layerCatalog).toHaveLength(1)
      expect(store.layerCatalog[0].key).toBe('base-image')
      expect(store.layerCatalog[0].category).toBe('base')
    })
  })

  describe('分析结果持久化版本校验 (b042)', () => {
    it('写入端使用 { version, data } 包装', () => {
      const store = useMapStore()
      store.setAnalysisResult({ foo: 'bar' })
      const raw = sessionStore.get('beibu-gulf-analysis-result')
      expect(raw).toBeDefined()
      const parsed = JSON.parse(raw!)
      expect(parsed.version).toBe(1)
      expect(parsed.data).toEqual({ foo: 'bar' })
    })

    it('读取端遇到旧格式（无 version）应丢弃并清空 sessionStorage', () => {
      // 模拟旧格式数据（b042 升级前的写入）
      sessionStore.set('beibu-gulf-analysis-result', JSON.stringify({ foo: 'legacy' }))
      // 重新创建 store 实例触发 readStoredAnalysisResult
      setActivePinia(createPinia())
      const store = useMapStore()
      // 旧格式应被丢弃：lastAnalysisResult 为空
      expect(store.lastAnalysisResult).toBeNull()
      // sessionStorage 中的旧格式应被清除
      expect(sessionStore.has('beibu-gulf-analysis-result')).toBe(false)
    })

    it('读取端遇到 version 不匹配应丢弃', () => {
      sessionStore.set(
        'beibu-gulf-analysis-result',
        JSON.stringify({ version: 999, data: { foo: 'future' } })
      )
      setActivePinia(createPinia())
      const store = useMapStore()
      expect(store.lastAnalysisResult).toBeNull()
    })

    it('读取端遇到缺 data 字段应丢弃', () => {
      sessionStore.set('beibu-gulf-analysis-result', JSON.stringify({ version: 1, noData: true }))
      setActivePinia(createPinia())
      const store = useMapStore()
      expect(store.lastAnalysisResult).toBeNull()
    })

    it('读取端遇到合法 { version, data } 应正常恢复 lastAnalysisResult', () => {
      sessionStore.set(
        'beibu-gulf-analysis-result',
        JSON.stringify({ version: 1, data: { foo: 'valid' } })
      )
      setActivePinia(createPinia())
      const store = useMapStore()
      expect(store.lastAnalysisResult).toEqual({ foo: 'valid' })
    })
  })
})

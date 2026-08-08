// BusinessLayerManager 适配器数据形状护栏回归测试（R-6 / TS-2）
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
 * 实施计划 08「步骤 3 蓝图」对 setVisible 的断言（manager 应通过 mapStore.setLayerVisible 改可见性）
 * 与实际实现一致，予以保留。真实实现见 BusinessLayerManager.ts:
 * - this._mapStore.setLayerVisible(key, visible)：经 Pinia action 改写 visible（DevTools 可追踪）
 * - renderer.setVisibility(key, visible)：显隐图层但不销毁（数据仍保留在 renderer 内）
 * 本用例据此断言两者均被调用、且 catalog 条目的 visible 经 store action 更新。
 */
describe('BusinessLayerManager', () => {
  let manager: BusinessLayerManager

  let mapStore: ReturnType<typeof createMockMapStore>

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
      mapStore.currentRenderer = renderer as unknown as MapRenderer

      manager.setVisible('vis-layer', false)

      // 真实实现：经 Pinia action 改写 visible
      expect(mapStore.setLayerVisible).toHaveBeenCalledWith('vis-layer', false)
      // 同时调 renderer.setVisibility 显隐（不销毁图层）
      expect(renderer.setVisibility).toHaveBeenCalledWith('vis-layer', false)
      // catalog 条目 visible 被 store action 更新
      const entry = mapStore.layerCatalog.find((e: MockCatalogEntry) => e.key === 'vis-layer')
      expect(entry!.visible).toBe(false)
    })

    it('b058: visible:false 注册的图层打开时补建（setVisible(true) → adapter.create）', () => {
      // register(visible:false) 不 create（BLM.register 判据 visible && data != null）
      manager.register('late-layer', {
        label: '延迟补建测试',
        layerType: 'geotiff',
        data: '/static/dem/dem_hillshade.tif',
        visible: false,
      })

      const renderer = { setVisibility: vi.fn(), hasLayer: vi.fn(() => false), addGeoTIFFLayer: vi.fn() }
      mapStore.currentRenderer = renderer as unknown as MapRenderer

      // 打开 → 图层未创建 → 必须补建（否则 setVisibility 落入 pending = 死按钮）
      manager.setVisible('late-layer', true)

      expect(renderer.addGeoTIFFLayer).toHaveBeenCalledWith(
        'late-layer',
        '/static/dem/dem_hillshade.tif',
        expect.anything()
      )
      expect(renderer.setVisibility).toHaveBeenCalledWith('late-layer', true)
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

    it('catalog 被 clearLayerCatalog 清空后（引擎切换）reapplyAll 仍应重绘', () => {
      manager.register('survivor-layer', {
        label: '清空后重绘',
        layerType: 'points',
        data: [{ lng: 108, lat: 21 }],
        visible: true,
      })

      // 模拟 UnifiedMap.setupLayers → clearLayers → clearLayerCatalog 清空目录
      mapStore.layerCatalog.length = 0

      const newRenderer = { addPointLayer: vi.fn() }
      manager.reapplyAll(newRenderer as unknown as MapRenderer)

      // 可见性存于 registry，不受 catalog 清空影响 → 必须重绘
      expect(newRenderer.addPointLayer).toHaveBeenCalledTimes(1)
      expect(newRenderer.addPointLayer).toHaveBeenCalledWith(
        'survivor-layer',
        [{ lng: 108, lat: 21 }],
        // 2026-08-08：BLM create 注入 onError（失败回滚意图），options 不再为空
        expect.objectContaining({ onError: expect.any(Function) })
      )
    })

    it('catalog 被清空后 reapplyAll 应重建面板条目（a018：切 3D 后图层控制面板丢勾选项）', () => {
      manager.register('panel-layer', {
        label: '真实地形',
        layerType: 'geotiff',
        data: '/static/dem/dem_hillshade.tif',
        visible: true,
      })

      // 引擎切换：UnifiedMap.setupLayers → clearLayerCatalog 清空目录
      mapStore.layerCatalog.length = 0

      const newRenderer = { addGeoTIFFLayer: vi.fn() }
      manager.reapplyAll(newRenderer as unknown as MapRenderer)

      // 面板条目必须重建（label 来自 registry，visible 以 registry 为准）
      expect(mapStore.registerBusinessLayer).toHaveBeenCalledWith(
        'panel-layer',
        '真实地形',
        'geotiff',
        true
      )
      expect(mapStore.layerCatalog.some((e: MockCatalogEntry) => e.key === 'panel-layer')).toBe(
        true
      )
      // 视觉实例照常重绘
      expect(newRenderer.addGeoTIFFLayer).toHaveBeenCalledTimes(1)
    })

    it('catalog 已有条目时 reapplyAll 不应重复注册（幂等）', () => {
      manager.register('dup-panel-layer', {
        label: '已有条目',
        layerType: 'points',
        data: [{ lng: 108, lat: 21 }],
        visible: true,
      })
      mapStore.registerBusinessLayer.mockClear()
      mapStore.layerCatalog.length = 1 // 模拟 catalog 未被清空（条目仍在）

      const newRenderer = { addPointLayer: vi.fn() }
      manager.reapplyAll(newRenderer as unknown as MapRenderer)

      // 条目已存在 → 不重复注册
      expect(mapStore.registerBusinessLayer).not.toHaveBeenCalled()
      expect(newRenderer.addPointLayer).toHaveBeenCalledTimes(1)
    })

    it('不可见图层（registry.visible=false）不应重绘', () => {
      manager.register('hidden-layer', {
        label: '隐藏图层',
        layerType: 'points',
        data: [{ lng: 108, lat: 21 }],
        visible: true,
      })
      // 先通过 setVisible 隐藏（registry.visible 同步更新）
      const renderer = { setVisibility: vi.fn(), addPointLayer: vi.fn() }
      mapStore.currentRenderer = renderer as unknown as MapRenderer
      manager.setVisible('hidden-layer', false)

      const newRenderer = { addPointLayer: vi.fn() }
      manager.reapplyAll(newRenderer as unknown as MapRenderer)

      expect(newRenderer.addPointLayer).not.toHaveBeenCalled()
    })

    it('data==null 的图层（如 flood-area 等 API 返回后渲染）也应重建面板条目（a046）', () => {
      manager.register('flood-area', {
        label: '淹没范围',
        layerType: 'geojson',
        data: null,
        visible: true,
      })
      // 引擎切换：clearLayerCatalog 清空目录（数据未就绪时 data 仍为 null）
      mapStore.layerCatalog.length = 0

      const newRenderer = { addGeoJsonLayer: vi.fn() }
      manager.reapplyAll(newRenderer as unknown as MapRenderer)

      // 面板条目必须重建（data==null 不渲染但开关不能丢——渲染与面板脱节的根因）
      expect(mapStore.registerBusinessLayer).toHaveBeenCalledWith('flood-area', '淹没范围', 'geojson', true)
      expect(mapStore.layerCatalog.some((e: MockCatalogEntry) => e.key === 'flood-area')).toBe(true)
      // data==null → 不触发视觉创建
      expect(newRenderer.addGeoJsonLayer).not.toHaveBeenCalled()
    })
  })

  describe('removeAllFromRenderer', () => {
    it('应从指定 renderer 移除视觉实例但保留 registry（防止跨引擎孤儿图层）', () => {
      const olRenderer = { addPointLayer: vi.fn(), removeLayer: vi.fn() }
      mapStore.currentRenderer = olRenderer as unknown as MapRenderer

      // 模拟洪涝页在 2D(OL) 注册 dem-hillshade GeoTIFF（注册时立即渲染）
      manager.register('leak-layer', {
        label: '泄漏测试',
        layerType: 'points',
        data: [{ lng: 108, lat: 21 }],
        visible: true,
      })
      // 注册时立即渲染（visible && data != null）
      expect(olRenderer.addPointLayer).toHaveBeenCalledTimes(1)

      // 模拟切到 3D：从 OL 清掉视觉实例（不删 registry）
      manager.removeAllFromRenderer(olRenderer as unknown as MapRenderer)
      expect(olRenderer.removeLayer).toHaveBeenCalledWith('leak-layer')
      expect(manager.has('leak-layer')).toBe(true) // registry 仍在

      // 切到 Cesium 后 reapplyAll 重绘到新 renderer
      const cesiumRenderer = { addPointLayer: vi.fn(), removeLayer: vi.fn() }
      manager.reapplyAll(cesiumRenderer as unknown as MapRenderer)
      expect(cesiumRenderer.addPointLayer).toHaveBeenCalledTimes(1)
      // OL 上不应二次渲染（已被 removeAllFromRenderer 清理，不会成为孤儿）
      expect(olRenderer.addPointLayer).toHaveBeenCalledTimes(1)
    })

    it('renderer 为 null 时安全跳过（不抛错）', () => {
      manager.register('null-rm', {
        label: '空渲染器',
        layerType: 'points',
        data: [{ lng: 108, lat: 21 }],
        visible: true,
      })
      expect(() => manager.removeAllFromRenderer(null)).not.toThrow()
      expect(manager.has('null-rm')).toBe(true)
    })
  })

  describe('adapter 数据形状守卫 (TS-2)', () => {
    it('points 收到 FeatureCollection 对象应抛"必须是 PointFeature[]"', () => {
      const renderer = { addPointLayer: vi.fn() }
      mapStore.currentRenderer = renderer as unknown as MapRenderer
      expect(() =>
        manager.register('bad-points', {
          label: '错误形状',
          layerType: 'points',
          data: { type: 'FeatureCollection' },
          visible: true,
        })
      ).toThrow(/必须是 PointFeature\[\]/)
    })

    it('points 收到 PointFeature[] 应正常注册且不抛错', () => {
      const renderer = { addPointLayer: vi.fn() }
      mapStore.currentRenderer = renderer as unknown as MapRenderer
      expect(() =>
        manager.register('good-points', {
          label: '正确形状',
          layerType: 'points',
          data: [{ lng: 108, lat: 21 }],
          visible: true,
        })
      ).not.toThrow()
      expect(renderer.addPointLayer).toHaveBeenCalledTimes(1)
    })

    it('geojson 收到非 FeatureCollection 应抛"必须是 FeatureCollection"', () => {
      const renderer = { addGeoJsonLayer: vi.fn(), removeLayer: vi.fn() }
      mapStore.currentRenderer = renderer as unknown as MapRenderer
      expect(() =>
        manager.register('bad-geojson', {
          label: '错误形状',
          layerType: 'geojson',
          data: [{ lng: 108, lat: 21 }],
          visible: true,
        })
      ).toThrow(/必须是 FeatureCollection/)
    })
  })

  describe('updateData 补建缺失图层（P0-3 回归）', () => {
    it('注册 data 为 null 的图层,数据到达时补 create 而非 update（热力图首屏根因）', () => {
      const renderer = {
        hasLayer: vi.fn().mockReturnValue(false),
        addHeatmapLayer: vi.fn(),
        updateHeatmapLayer: vi.fn(),
      }
      mapStore.currentRenderer = renderer as unknown as MapRenderer
      manager.register('forecast-cargo', {
        label: '热力',
        layerType: 'heatmap',
        data: null,
        visible: true,
      })
      manager.updateData('forecast-cargo', { data: [{ lng: 108, lat: 21, value: 1 }] })

      expect(renderer.addHeatmapLayer).toHaveBeenCalledTimes(1)
      expect(renderer.updateHeatmapLayer).not.toHaveBeenCalled()
    })

    it('图层实例已存在时 updateData 走 update 不走 create', () => {
      const renderer = {
        hasLayer: vi.fn().mockReturnValue(true),
        addHeatmapLayer: vi.fn(),
        updateHeatmapLayer: vi.fn(),
      }
      mapStore.currentRenderer = renderer as unknown as MapRenderer
      manager.register('forecast-cargo', {
        label: '热力',
        layerType: 'heatmap',
        data: null,
        visible: true,
      })
      manager.updateData('forecast-cargo', { data: [{ lng: 108, lat: 21, value: 1 }] })

      expect(renderer.updateHeatmapLayer).toHaveBeenCalledTimes(1)
      expect(renderer.addHeatmapLayer).not.toHaveBeenCalled()
    })

    it('不可见图层 updateData 不建不更（保持现有语义）', () => {
      const renderer = {
        hasLayer: vi.fn(),
        addHeatmapLayer: vi.fn(),
        updateHeatmapLayer: vi.fn(),
      }
      mapStore.currentRenderer = renderer as unknown as MapRenderer
      manager.register('hidden', {
        label: '隐藏',
        layerType: 'heatmap',
        data: null,
        visible: false,
      })
      manager.updateData('hidden', { data: [{ lng: 108, lat: 21, value: 1 }] })

      expect(renderer.addHeatmapLayer).not.toHaveBeenCalled()
      expect(renderer.updateHeatmapLayer).not.toHaveBeenCalled()
    })
  })

  describe('setVisible 特殊图层分派（P0-4 回归）', () => {
    it('waterSurface 图层经 adapter.setVisibility 委派 setWaterSurfaceVisibility', () => {
      const renderer = {
        setWaterSurfaceVisibility: vi.fn(),
        addWaterSurface: vi.fn(),
        updateWaterLevel: vi.fn(),
        removeWaterSurface: vi.fn(),
      }
      mapStore.currentRenderer = renderer as unknown as MapRenderer
      manager.register('water', {
        label: '水面',
        layerType: 'waterSurface',
        data: { coordinates: [[108, 21]], height: 2 },
        visible: true,
      })
      manager.setVisible('water', false)

      expect(renderer.setWaterSurfaceVisibility).toHaveBeenCalledWith('water', false)
    })

    it('普通图层仍走 renderer.setVisibility', () => {
      const renderer = { setVisibility: vi.fn(), addPointLayer: vi.fn() }
      mapStore.currentRenderer = renderer as unknown as MapRenderer
      manager.register('pts', {
        label: '点',
        layerType: 'points',
        data: [{ lng: 108, lat: 21 }],
        visible: true,
      })
      manager.setVisible('pts', false)

      expect(renderer.setVisibility).toHaveBeenCalledWith('pts', false)
    })
  })
})

// BusinessLayerManager 适配器数据形状护栏回归测试
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MapRenderer } from '@/types'
import type { LayerType } from '@/types/core/layerManager'

import {
  BusinessLayerManager,
  layerFailureMessage,
  type LayerErrorPayload,
} from '../BusinessLayerManager'

/** mock catalog 条目 */
interface MockCatalogEntry {
  key: string
  label: string
  layerType: LayerType
  visible: boolean
  category: 'base' | 'business'
  listed?: boolean
  locked?: boolean
}

/** mock mapStore — 仅 BusinessLayerManager 使用的方法 */
function createMockMapStore() {
  const catalog: MockCatalogEntry[] = []
  return {
    layerCatalog: catalog,
    currentRenderer: null as MapRenderer | null,
    registerBusinessLayer: vi.fn(
      (
        key: string,
        label: string,
        layerType: LayerType,
        visible: boolean,
        _engines?: unknown,
        listed?: boolean,
        locked?: boolean
      ) => {
        catalog.push({ key, label, layerType, visible, category: 'business', listed, locked })
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
 * setVisible 契约：经 mapStore.setLayerVisible（Pinia action，DevTools 可追踪）改目录条目，
 * 同时调 renderer.setVisibility 显隐（不销毁图层）——本用例断言两者均被调用。
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
        true,
        ['openlayers', 'cesium'],
        true,
        false
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

      const renderer = {
        setVisibility: vi.fn(),
        hasLayer: vi.fn(() => false),
        addGeoTIFFLayer: vi.fn(() => true),
      }
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
        // BLM create 注入 onError（失败回滚意图），options 不再为空
        expect.objectContaining({ onError: expect.any(Function) })
      )
    })

    it('🔴 注入的 onError 被回调 ⇒ 回滚 + 上报（不是只注入一个函数样子）', () => {
      // 形态断言（`onError: expect.any(Function)`）挡不住"注入了但函数体是空的"：
      // 把 onError 换成 `() => undefined` 后形态断言仍绿、而生产失败零回滚零上报。
      // 本用例按**行为**钉：真的调一次，断言回滚与上报都发生。
      const captured: Array<(err: unknown) => void> = []
      const renderer = {
        addPointLayer: vi.fn(
          (_key: string, _data: unknown, options?: { onError?: (e: unknown) => void }) => {
            if (options?.onError) captured.push(options.onError)
          }
        ),
        setVisibility: vi.fn(),
        hasLayer: vi.fn().mockReturnValue(false),
      }
      mapStore.currentRenderer = renderer as unknown as MapRenderer
      const payloads: LayerErrorPayload[] = []
      manager.setErrorHandler((p) => payloads.push(p))

      manager.register('async-fail', {
        label: '异步失败层',
        layerType: 'points',
        data: [{ lng: 108, lat: 21 }],
        visible: true,
      })

      // adapter 侧异步失败（不抛、只回调 onError）⇒ 必须回滚可见性并上报
      expect(captured).toHaveLength(1)
      captured[0](new Error('渲染器异步失败'))

      expect(manager.getMeta('async-fail')?.visible).toBe(false)
      expect(payloads).toHaveLength(1)
      expect(payloads[0]).toMatchObject({
        key: 'async-fail',
        label: '异步失败层',
        retryable: true,
      })
    })

    it('catalog 被清空后 reapplyAll 应重建面板条目（切 3D 后图层控制面板丢勾选项）', () => {
      manager.register('panel-layer', {
        label: '真实地形',
        layerType: 'geotiff',
        data: '/static/dem/dem_hillshade.tif',
        visible: true,
      })

      // 引擎切换：UnifiedMap.setupLayers → clearLayerCatalog 清空目录
      mapStore.layerCatalog.length = 0

      const newRenderer = { addGeoTIFFLayer: vi.fn(() => true) }
      manager.reapplyAll(newRenderer as unknown as MapRenderer)

      // 面板条目必须重建（label 来自 registry，visible 以 registry 为准）
      expect(mapStore.registerBusinessLayer).toHaveBeenCalledWith(
        'panel-layer',
        '真实地形',
        'geotiff',
        true,
        // engines 透传（W6 第四半）：geotiff 是 Cesium 独占能力（adapter 声明 engines: ['cesium']）
        // 旧形态此处传 undefined ⇒ mapStore 双引擎默认值，目录侧对单引擎图层"谎报双引擎"
        ['cesium'],
        true,
        false
      )
      expect(mapStore.layerCatalog.some((e: MockCatalogEntry) => e.key === 'panel-layer')).toBe(
        true
      )
      // 视觉实例照常重绘
      expect(newRenderer.addGeoTIFFLayer).toHaveBeenCalledTimes(1)
    })

    it('登出清目录后 reconcileWithRenderer 应恢复常驻层面板条目（d116：登出后图层控制按钮缺失）', () => {
      // core 常驻层（boundary/ports）经 UnifiedMap.setupLayers 注册：registry + catalog 均有
      manager.register('boundary', {
        label: '行政区划',
        layerType: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        visible: true,
      })
      manager.register('ports', {
        label: '港口位置',
        layerType: 'points',
        data: [{ lng: 108, lat: 21 }],
        visible: true,
      })

      // 模拟登出 resetStores → mapStore.resetMapState：目录 business 条目全删，
      // 但 registry（App 级持久）与渲染器图层实例均保留（图层照常显示）
      mapStore.layerCatalog.length = 0
      mapStore.currentRenderer = {
        hasLayer: () => true,
        setVisibility: vi.fn(),
      } as unknown as MapRenderer

      // App.vue resetStores 尾部的对账调用（registry 为目录唯一权威源）
      manager.reconcileWithRenderer()

      // 常驻层目录条目按 registry 重建 → 面板按钮恢复
      expect(mapStore.registerBusinessLayer).toHaveBeenCalledWith(
        'boundary',
        '行政区划',
        'geojson',
        true,
        // engines 透传（W6 第四半）：这些图层注册时未指定 engines ⇒ 双引擎默认值
        // （旧形态此处传 undefined 让 mapStore 兜默认值，等于让目录侧"谎报双引擎"）
        ['openlayers', 'cesium'],
        true,
        false
      )
      expect(mapStore.registerBusinessLayer).toHaveBeenCalledWith(
        'ports',
        '港口位置',
        'points',
        true,
        // engines 透传（W6 第四半）：这些图层注册时未指定 engines ⇒ 双引擎默认值
        // （旧形态此处传 undefined 让 mapStore 兜默认值，等于让目录侧"谎报双引擎"）
        ['openlayers', 'cesium'],
        true,
        false
      )
      expect(mapStore.layerCatalog.some((e: MockCatalogEntry) => e.key === 'boundary')).toBe(true)
      expect(mapStore.layerCatalog.some((e: MockCatalogEntry) => e.key === 'ports')).toBe(true)
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

    it('data==null 的图层（如 flood-area 等 API 返回后渲染）也应重建面板条目', () => {
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
      expect(mapStore.registerBusinessLayer).toHaveBeenCalledWith(
        'flood-area',
        '淹没范围',
        'geojson',
        true,
        // engines 透传（W6 第四半）：这些图层注册时未指定 engines ⇒ 双引擎默认值
        // （旧形态此处传 undefined 让 mapStore 兜默认值，等于让目录侧"谎报双引擎"）
        ['openlayers', 'cesium'],
        true,
        false
      )
      expect(mapStore.layerCatalog.some((e: MockCatalogEntry) => e.key === 'flood-area')).toBe(true)
      // data==null → 不触发视觉创建
      expect(newRenderer.addGeoJsonLayer).not.toHaveBeenCalled()
    })
  })

  // a029：开关亮着、屏幕上没有——原先只在 debug 日志里逐层留痕，面板无从感知。
  // 本组钉"汇总上抛 + 补建后摘除"两条：只判"会不会抛"，删掉摘除逻辑照样能过。
  describe('未上屏图层汇总（a029）', () => {
    it('🔴 visible=true 但 data 未就绪 ⇒ 汇总出该层；用户自己关掉的层不算缺失', () => {
      manager.register('forecast-heat', {
        label: '预测图层',
        layerType: 'points',
        data: null,
        visible: true,
      })
      // 对照组：用户关掉的层（visible=false）不是"缺失"
      manager.register('user-off', {
        label: '用户关掉的层',
        layerType: 'points',
        data: [{ lng: 108, lat: 21 }],
        visible: false,
      })

      const renderer = { addPointLayer: vi.fn(), hasLayer: vi.fn().mockReturnValue(false) }
      const notMounted = manager.reapplyAll(renderer as unknown as MapRenderer)

      expect(notMounted).toEqual([{ key: 'forecast-heat', label: '预测图层' }])
      expect(manager.isNotMounted('forecast-heat')).toBe(true)
      expect(manager.isNotMounted('user-off')).toBe(false)
      expect(manager.notMountedLayers()).toEqual([{ key: 'forecast-heat', label: '预测图层' }])
    })

    it('🔴 数据到位补建成功 ⇒ 自动摘出清单（否则标灰会永远留在按钮上）', () => {
      const renderer = {
        addPointLayer: vi.fn(),
        hasLayer: vi.fn().mockReturnValue(false),
        setVisibility: vi.fn(),
      }
      mapStore.currentRenderer = renderer as unknown as MapRenderer
      manager.register('lazy', {
        label: '迟到图层',
        layerType: 'points',
        data: null,
        visible: true,
      })
      expect(manager.isNotMounted('lazy')).toBe(true)

      // 数据到达 → updateData 走 create 补建
      manager.updateData('lazy', { data: [{ lng: 108, lat: 21 }] })

      expect(renderer.addPointLayer).toHaveBeenCalled()
      expect(manager.isNotMounted('lazy')).toBe(false)
      expect(manager.notMountedLayers()).toEqual([])
    })

    it('关掉或移除图层后清单不留脏条目', () => {
      const renderer = {
        addPointLayer: vi.fn(),
        hasLayer: vi.fn().mockReturnValue(false),
        setVisibility: vi.fn(),
        removeLayer: vi.fn(),
      }
      mapStore.currentRenderer = renderer as unknown as MapRenderer
      manager.register('gone', { label: '要走', layerType: 'points', data: null, visible: true })
      expect(manager.isNotMounted('gone')).toBe(true)

      // 用户关掉它 → 不再是"想显示却没上屏"
      manager.setVisible('gone', false)
      expect(manager.isNotMounted('gone')).toBe(false)

      // 再打开（仍无数据）→ 重新标记；注销则彻底摘除
      manager.setVisible('gone', true)
      expect(manager.isNotMounted('gone')).toBe(true)
      manager.remove('gone')
      expect(manager.isNotMounted('gone')).toBe(false)
    })
  })

  describe('reapplyAll 目录条目重建透传 engines（W6 第四半）', () => {
    it('🔴 重建条目按 registry.engines 登记，不谎报双引擎', () => {
      const renderer = {
        addPointLayer: vi.fn(),
        hasLayer: vi.fn().mockReturnValue(false),
        getType: () => '3d',
      }
      mapStore.currentRenderer = renderer as unknown as MapRenderer
      manager.register('ol-only', {
        label: '二维专用',
        layerType: 'points',
        data: [{ lng: 108, lat: 21 }],
        visible: true,
        engines: ['openlayers'],
      })
      // 引擎切换后目录被清空 → reapplyAll 按 registry 重建条目
      mapStore.layerCatalog = []
      mapStore.registerBusinessLayer.mockClear()

      manager.reapplyAll(renderer as unknown as MapRenderer)

      // 旧形态第 5 参传 undefined ⇒ mapStore 默认值兜成双引擎，面板据此把不该亮的条目画成可点
      expect(mapStore.registerBusinessLayer).toHaveBeenCalledWith(
        'ol-only',
        '二维专用',
        'points',
        true,
        ['openlayers'],
        true,
        false
      )
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
    it('points 收到 FeatureCollection 对象应抛"必须是 PointFeature[]"，且回滚不留脏', () => {
      // 同步抛错也必须走 _handleCreateFailure——断言「抛错后 registry/catalog
      // 均为 false」，而不是只断言 toThrow（旧用例把"留脏"当通过：
      // registry/catalog 停在 visible=true ⇒ 面板亮、屏幕上无、零提示）
      const renderer = { addPointLayer: vi.fn() }
      mapStore.currentRenderer = renderer as unknown as MapRenderer
      const onError = vi.fn()
      manager.setErrorHandler(onError)
      expect(() =>
        manager.register('bad-points', {
          label: '错误形状',
          layerType: 'points',
          data: { type: 'FeatureCollection' },
          visible: true,
        })
      ).toThrow(/必须是 PointFeature\[\]/)
      expect(manager.has('bad-points')).toBe(true) // registry 条目仍在（可重试）
      expect(manager.getMeta('bad-points')?.visible).toBe(false) // 但可见性已回滚
      expect(mapStore.layerCatalog.find((e) => e.key === 'bad-points')?.visible).toBe(false)
      expect(onError).toHaveBeenCalledTimes(1) // 上报链路真的触发
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

    it('🔴 update 抛错同样走回滚+上报后上抛（删回滚即红）', () => {
      // 旧形态：updateData 自建 try/catch，与 create 包装各一份 —— 删掉 update 那份回滚
      // 全仓测试全绿（面板亮、屏幕上无、零提示）。并入 _runAdapter 后本断言承重。
      const renderer = {
        hasLayer: vi.fn().mockReturnValue(true),
        addHeatmapLayer: vi.fn(),
        updateHeatmapLayer: vi.fn(() => {
          throw new Error('update 失败')
        }),
      }
      mapStore.currentRenderer = renderer as unknown as MapRenderer
      const onError = vi.fn()
      manager.setErrorHandler(onError)
      manager.register('forecast-cargo', {
        label: '热力',
        layerType: 'heatmap',
        data: null,
        visible: true,
      })

      expect(() =>
        manager.updateData('forecast-cargo', { data: [{ lng: 108, lat: 21, value: 1 }] })
      ).toThrow('update 失败')

      // 回滚 + 上报（与 create 同一条通道）
      expect(manager.getMeta('forecast-cargo')?.visible).toBe(false)
      expect(mapStore.layerCatalog.find((e) => e.key === 'forecast-cargo')?.visible).toBe(false)
      expect(onError).toHaveBeenCalledTimes(1)
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

  describe('失败回调的可重放判据（W5：文案承诺的动作必须真能由 payload 驱动）', () => {
    it('🔴 已登记且有数据 ⇒ retryable=true，且提示承诺的动作（面板开关）真能重试成功', () => {
      let attempt = 0
      const renderer = {
        addPointLayer: vi.fn(() => {
          attempt++
          if (attempt === 1) throw new Error('首次失败') // 首次失败、重试成功
        }),
        setVisibility: vi.fn(),
        hasLayer: vi.fn().mockReturnValue(false),
      }
      mapStore.currentRenderer = renderer as unknown as MapRenderer
      const payloads: LayerErrorPayload[] = []
      manager.setErrorHandler((p) => payloads.push(p))

      expect(() =>
        manager.register('retry-points', {
          label: '可重试',
          layerType: 'points',
          data: [{ lng: 108, lat: 21 }],
          visible: true,
        })
      ).toThrow('首次失败')

      expect(payloads).toHaveLength(1)
      expect(payloads[0]).toMatchObject({ key: 'retry-points', label: '可重试', retryable: true })
      expect(layerFailureMessage(payloads[0])).toContain('点击图层面板里的开关重试')

      // 文案承诺的动作 = 面板开关（由 payload.key 驱动）→ 必须真能重试（第二次不再抛）
      manager.setVisible('retry-points', true)
      expect(renderer.addPointLayer).toHaveBeenCalledTimes(2)
      expect(manager.getMeta('retry-points')?.visible).toBe(true)
    })

    it('🔴 未登记图层（listed:false）⇒ retryable=false，文案不承诺"再点一次"', () => {
      const renderer = {
        addPointLayer: vi.fn(() => {
          throw new Error('失败')
        }),
      }
      mapStore.currentRenderer = renderer as unknown as MapRenderer
      const payloads: LayerErrorPayload[] = []
      manager.setErrorHandler((p) => payloads.push(p))

      expect(() =>
        manager.register('silent-points', {
          label: '静默层',
          layerType: 'points',
          data: [{ lng: 108, lat: 21 }],
          visible: true,
          listed: false,
        })
      ).toThrow()

      // 面板没有该条目 ⇒ 没有按钮可点，"再点一次"是空承诺
      expect(payloads[0].retryable).toBe(false)
      expect(layerFailureMessage(payloads[0])).toContain('刷新页面')
      expect(layerFailureMessage(payloads[0])).not.toContain('开关重试')
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

  // ── listed / locked 语义（04 清单 A4：图层状态只能有一个事实源） ──────────────
  // 场景：地形山影按需求要「默认开、不进图层面板、关不掉」。若为此绕过 BLM 直接
  // 挂渲染器，就出现了第二个事实源（BLM 不知道它存在），正是 A4 明令禁止的形态。
  // 故改为「仍走 BLM 注册，但登记时声明 listed:false / locked:true」。
  describe('listed / locked — 登记但不呈现、可见性锁定', () => {
    it('listed:false 仍进 registry 与 catalog（事实源不变），只是标记了不列出', () => {
      manager.register('dem', {
        label: '地形山影',
        layerType: 'geotiff',
        data: '/static/dem/x.tif',
        visible: true,
        listed: false,
        locked: true,
      })

      // 关键：仍在 BLM registry 里（has 为真）——若绕开 BLM 就没有这条
      expect(manager.has('dem')).toBe(true)
      const meta = manager.getMeta('dem')
      expect(meta?.listed).toBe(false)
      expect(meta?.locked).toBe(true)
      // catalog 条目也带上了标记，供面板过滤
      expect(mapStore.layerCatalog[0].listed).toBe(false)
      expect(mapStore.layerCatalog[0].locked).toBe(true)
    })

    it('locked 层拒绝关闭：setVisible(false) 不生效，渲染器也不被调用', () => {
      // addGeoTIFFLayer 契约返回 boolean（renderer.ts:121）：adapter 以 false 表达创建失败
      // 并上行 onError，BLM 随即回滚。mock 必须回 true，否则等于模拟了一次创建失败
      const renderer = { setVisibility: vi.fn(), addGeoTIFFLayer: vi.fn(() => true) }
      mapStore.currentRenderer = renderer as unknown as MapRenderer
      manager.register('dem', {
        label: '地形山影',
        layerType: 'geotiff',
        data: '/static/dem/x.tif',
        visible: true,
        listed: false,
        locked: true,
      })

      manager.setVisible('dem', false)

      // registry 仍为可见
      expect(manager.getMeta('dem')?.visible).toBe(true)
      // 未下发任何显隐指令
      expect(renderer.setVisibility).not.toHaveBeenCalled()
      // 目录镜像也没被改
      expect(mapStore.layerCatalog[0].visible).toBe(true)
    })

    it('locked 层允许「开」方向（幂等，用于引擎切换后重新拉齐）', () => {
      const renderer = {
        setVisibility: vi.fn(),
        addGeoTIFFLayer: vi.fn(() => true),
        hasLayer: vi.fn(() => true),
      }
      mapStore.currentRenderer = renderer as unknown as MapRenderer
      manager.register('dem', {
        label: '地形山影',
        layerType: 'geotiff',
        data: '/static/dem/x.tif',
        visible: true,
        listed: false,
        locked: true,
      })

      manager.setVisible('dem', true)

      expect(manager.getMeta('dem')?.visible).toBe(true)
      expect(renderer.setVisibility).toHaveBeenCalledWith('dem', true)
    })

    it('对照：未锁定的普通图层照常可关（证明锁是真的在起作用，不是全局禁关）', () => {
      const renderer = { setVisibility: vi.fn(), addPointLayer: vi.fn() }
      mapStore.currentRenderer = renderer as unknown as MapRenderer
      manager.register('pts', {
        label: '点',
        layerType: 'points',
        data: [{ lng: 108, lat: 21 }],
        visible: true,
      })

      manager.setVisible('pts', false)

      expect(manager.getMeta('pts')?.visible).toBe(false)
      expect(renderer.setVisibility).toHaveBeenCalledWith('pts', false)
    })

    it('引擎切换后 reapplyAll 重建目录条目时 listed/locked 原样带上（否则锁会失效）', () => {
      manager.register('dem', {
        label: '地形山影',
        layerType: 'geotiff',
        data: '/static/dem/x.tif',
        visible: true,
        listed: false,
        locked: true,
      })
      // 模拟引擎切换：目录被清空，registry 保留
      mapStore.layerCatalog.length = 0

      // 需要真实 renderer——reapplyAll(null) 直接 return，目录不会重建
      const renderer = {
        addGeoTIFFLayer: vi.fn(() => true),
        hasLayer: vi.fn(() => false),
        getType: vi.fn(() => '3d'),
      }
      manager.reapplyAll(renderer as unknown as MapRenderer)

      expect(mapStore.layerCatalog[0].listed).toBe(false)
      expect(mapStore.layerCatalog[0].locked).toBe(true)
    })
  })
})

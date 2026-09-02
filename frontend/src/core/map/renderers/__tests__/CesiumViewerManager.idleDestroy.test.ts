/**
 * CesiumViewerManager 30s 空闲销毁链路运行级验证
 *
 * 验证背景（用户报 bug：洪涝页 3D → 去 2D 路由 → 停留 >30s → 回洪涝页 → 地图白板）：
 * - 引入单例时注释声称"unmount 不销毁、再次 mount 复用"，
 *   但 unmount() 实现同时启动 30s 空闲销毁计时器 → destroy() → viewer 置 null。
 * - UnifiedMap.switchMapType 3D→2D 时主动调 unmount()，
 *   使 30s 销毁路径在真实路由切换中可达。
 * - 回 3D 时 UnifiedMap.initRenderer 走复用分支，只调 cesiumViewerManager.mount()，
 *   而 mount() 在 viewer 为 null 时静默 return false —— 容器不恢复 → 白板。
 *
 * 本测试验证该链路的三段事实：
 * 1. unmount 会启动 30s 计时器（"只是取消挂载"并不成立，销毁在倒计时）
 * 2. 30s 后 viewer 被真实销毁（destroy 被调、viewer 置 null）
 * 3. viewer 销毁后 mount() 返回 false、容器不恢复（白板根因）
 * 4. 对照：30s 内切回，mount 清除计时器，viewer 存活（快速切换不受影响）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 全量 mock cesium（同 CesiumRenderer.geojson.test.ts 的 chainable 方案），
// 本测试不触发 create()（不 new Viewer），仅操作已注入的 fake viewer。
vi.mock('cesium', () => {
  function makeChainable(): object {
    return new Proxy(function () {}, {
      get(_t: unknown, prop: string | symbol) {
        if (prop === 'then') return undefined
        if (prop === 'fromCssColorString') return () => ({})
        return makeChainable()
      },
      apply() {
        return makeChainable()
      },
      construct() {
        return makeChainable()
      },
    })
  }

  class MockCesiumClass {
    constructor() {
      return makeChainable() as unknown as MockCesiumClass
    }
  }

  return {
    CallbackProperty: MockCesiumClass,
    Cartesian2: MockCesiumClass,
    Cartesian3: MockCesiumClass,
    Cartographic: MockCesiumClass,
    Color: { fromCssColorString: () => ({}) },
    ColorGeometryInstanceAttribute: MockCesiumClass,
    GeoJsonDataSource: { load: vi.fn().mockResolvedValue({ entities: { values: [] } }) },
    GeographicTilingScheme: MockCesiumClass,
    GeometryInstance: MockCesiumClass,
    Math: { toRadians: () => 0, fromRadians: () => 0 },
    PerInstanceColorAppearance: MockCesiumClass,
    PointGraphics: MockCesiumClass,
    PolygonGeometry: MockCesiumClass,
    PolygonHierarchy: MockCesiumClass,
    Primitive: MockCesiumClass,
    Rectangle: MockCesiumClass,
    ScreenSpaceEventType: MockCesiumClass,
    SingleTileImageryProvider: MockCesiumClass,
    UrlTemplateImageryProvider: MockCesiumClass,
    Viewer: MockCesiumClass,
  }
})

import { cesiumViewerManager } from '../CesiumRenderer'

/** 构造最小 fake viewer（不经过 create 的 new Viewer） */
function makeFakeViewer(container?: HTMLElement) {
  const el = container ?? document.createElement('div')
  const parent = document.createElement('div')
  parent.appendChild(el)
  const viewer = {
    container: el,
    scene: { requestRenderMode: false, requestRender: vi.fn(), screenSpaceCameraController: {} },
    resize: vi.fn(),
    destroy: vi.fn(),
  }
  return { viewer, container: el, parent }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  // 清理计时器，避免用例间残留；viewer 状态复位
  cesiumViewerManager._clearIdleDestroyTimer()
  ;(cesiumViewerManager as unknown as { viewer: null }).viewer = null
  ;(cesiumViewerManager as unknown as { isMounted: boolean }).isMounted = false
  vi.useRealTimers()
})

describe('5s 快速切换 v-show 重新挂载链路（用户实测复现路径，Bug A 修复验证）', () => {
  it('unmount 不再摘走 Vue 容器 div，快速切回 mount 后容器仍在文档（不白屏）', () => {
    // 模拟 UnifiedMap 模板结构：cesiumContainerRef div 挂在 unified-map-wrapper 下
    const wrapper = document.createElement('div')
    document.body.appendChild(wrapper)
    const container = document.createElement('div')
    wrapper.appendChild(container)
    // 模拟 Cesium 行为：viewer.container === 传入的容器 div 本身（同一元素）
    const viewer = {
      container,
      scene: { requestRenderMode: false, requestRender: vi.fn(), screenSpaceCameraController: {} },
      resize: vi.fn(),
      destroy: vi.fn(),
    }
    ;(cesiumViewerManager as unknown as { viewer: typeof viewer }).viewer = viewer
    ;(cesiumViewerManager as unknown as { isMounted: boolean }).isMounted = true

    // 进 3D：容器 div 在文档中
    expect(container.isConnected).toBe(true)

    // 去 2D：switchMapType 调 unmount() —— 修复后不再 removeChild，div 留在文档
    cesiumViewerManager.unmount()
    expect(container.isConnected).toBe(true)

    // 回 3D（5s 内，viewer 存活）：mount(container) 的 viewerContainer===el 分支
    // resize + 恢复渲染，容器仍在文档中 → 不白屏
    const ok = cesiumViewerManager.mount(container)
    expect(ok).toBe(true)
    expect(container.isConnected).toBe(true)
    expect(wrapper.contains(container)).toBe(true)
  })
})

describe('CesiumViewerManager 30s 空闲销毁链路', () => {
  it('unmount 启动 30s 计时器，30s 后 viewer 被真实销毁（destroy 调用 + viewer 置 null）', () => {
    const { viewer, container, parent } = makeFakeViewer()
    ;(cesiumViewerManager as unknown as { viewer: typeof viewer }).viewer = viewer
    ;(cesiumViewerManager as unknown as { isMounted: boolean }).isMounted = true

    cesiumViewerManager.unmount()

    // 修复后：不再 removeChild 摘走 Vue 容器 div（v-show 负责隐藏），
    // 容器仍留在 DOM 树 —— 快速切换回来时 mount 不会白屏
    expect(parent.contains(container)).toBe(true)
    // 暂停渲染 + 启动计时器
    expect(viewer.scene.requestRenderMode).toBe(true)

    // 29s：还没销毁
    vi.advanceTimersByTime(29_000)
    expect((cesiumViewerManager as unknown as { viewer: unknown }).viewer).not.toBeNull()

    // 30s：销毁触发
    vi.advanceTimersByTime(1_000)
    expect(viewer.destroy).toHaveBeenCalledTimes(1)
    expect((cesiumViewerManager as unknown as { viewer: unknown }).viewer).toBeNull()
  })

  it('viewer 已销毁后 mount() 静默返回 false，容器不恢复（白板根因）', () => {
    // 模拟 30s 销毁后的状态
    ;(cesiumViewerManager as unknown as { viewer: null }).viewer = null
    ;(cesiumViewerManager as unknown as { isMounted: boolean }).isMounted = false

    const el = document.createElement('div')
    const result = cesiumViewerManager.mount(el)

    expect(result).toBe(false)
    // 容器没有任何 DOM 被放回 —— 地图区域保持空白
    expect(el.children.length).toBe(0)
  })

  it('对照：30s 内切回，mount 清除计时器，viewer 存活（快速切换不受影响）', () => {
    const { viewer, container, parent } = makeFakeViewer()
    ;(cesiumViewerManager as unknown as { viewer: typeof viewer }).viewer = viewer
    ;(cesiumViewerManager as unknown as { isMounted: boolean }).isMounted = true

    cesiumViewerManager.unmount()
    // 29s 时切回 3D：mount 应把 viewer DOM 移回原容器并清除计时器
    vi.advanceTimersByTime(29_000)
    const ok = cesiumViewerManager.mount(parent)

    expect(ok).toBe(true)
    expect(parent.contains(container)).toBe(true)
    expect(viewer.destroy).not.toHaveBeenCalled()
    // 计时器已清除：再走 60s 也不会销毁
    vi.advanceTimersByTime(60_000)
    expect((cesiumViewerManager as unknown as { viewer: unknown }).viewer).not.toBeNull()
  })
})

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

import { CesiumRenderer, cesiumViewerManager } from '../CesiumRenderer'

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

/**
 * WebGL 上下文丢失监听的「挂/摘」配对（2026-09-11 修复回归锁定）。
 *
 * 病灶：监听原先以匿名箭头函数挂在 `viewer.scene.canvas` 上。Viewer 是**单例复用**
 * （cesiumViewerManager），canvas 在单例生命周期内不变 ⇒ 每次 renderer destroy 后
 * 重新 mount 都会再 addEventListener 到同一 canvas，而匿名函数没有引用可供 remove。
 * 后果：一次上下文丢失弹 N 次 toast，且闭包永久持有已销毁的 renderer。
 *
 * 修复：回调具名化（_webglContextLostHandler）+ destroyEvents 成对摘除。
 * 本用例断言「重复 mount → destroy 后，canvas 上注册的监听数不累加」。
 */
describe('WebGL 上下文丢失监听 add/remove 配对（重挂不累加）', () => {
  it('多次挂载后 destroy，canvas 上该监听不会累积（匿名函数病灶回归锁定）', () => {
    const canvas = document.createElement('canvas')
    const added: EventListenerOrEventListenerObject[] = []
    const removed: EventListenerOrEventListenerObject[] = []
    // 用真实 DOM canvas 记录 add/remove 对，避免依赖 Cesium 内部实现
    canvas.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject) => {
      if (type === 'webglcontextlost') added.push(fn)
    }) as typeof canvas.addEventListener
    canvas.removeEventListener = ((type: string, fn: EventListenerOrEventListenerObject) => {
      if (type === 'webglcontextlost') {
        const i = added.indexOf(fn)
        if (i >= 0) added.splice(i, 1)
        removed.push(fn)
      }
    }) as typeof canvas.removeEventListener

    const viewer = {
      container: document.createElement('div'),
      scene: {
        canvas,
        requestRenderMode: false,
        requestRender: vi.fn(),
        screenSpaceCameraController: {},
      },
      resize: vi.fn(),
      destroy: vi.fn(),
    }
    ;(cesiumViewerManager as unknown as { viewer: typeof viewer }).viewer = viewer
    ;(cesiumViewerManager as unknown as { isMounted: boolean }).isMounted = true

    // 模拟「挂载 → 销毁」三轮（单例复用下 canvas 始终是同一个）
    for (let i = 0; i < 3; i++) {
      cesiumViewerManager.registerWebglContextLostHandler()
      expect(added.length).toBe(1) // 每轮都只剩 1 个（上一轮已摘）
      cesiumViewerManager.unregisterWebglContextLostHandler()
    }
    expect(added.length).toBe(0)
    expect(removed.length).toBe(3) // 三次注册三次摘除，一一对应
  })
})

/**
 * 渲染循环错误监听的「挂/摘」配对：与上方 webglcontextlost 同病根——
 * scene.renderError 事件对象随单例 Viewer 常驻不变，匿名监听重挂即累加（a085 三连案的第三处）。
 */
describe('渲染循环错误监听 add/remove 配对（重挂不累加）', () => {
  it('多次注册后摘除，renderError 上该监听不会累积', () => {
    const added: unknown[] = []
    const removed: unknown[] = []
    const renderErrorEvent = {
      addEventListener: (fn: unknown) => {
        added.push(fn)
      },
      removeEventListener: (fn: unknown) => {
        const i = added.indexOf(fn)
        if (i >= 0) added.splice(i, 1)
        removed.push(fn)
      },
    }
    const viewer = {
      container: document.createElement('div'),
      scene: {
        canvas: document.createElement('canvas'),
        renderError: renderErrorEvent,
        requestRenderMode: false,
        requestRender: vi.fn(),
        screenSpaceCameraController: {},
      },
      resize: vi.fn(),
      destroy: vi.fn(),
    }
    ;(cesiumViewerManager as unknown as { viewer: typeof viewer }).viewer = viewer
    ;(cesiumViewerManager as unknown as { isMounted: boolean }).isMounted = true

    // 模拟「挂载 → 销毁」三轮（单例复用下 scene.renderError 始终是同一个事件对象）
    for (let i = 0; i < 3; i++) {
      cesiumViewerManager.registerRenderErrorHandler()
      expect(added.length).toBe(1) // 每轮都只剩 1 个（上一轮已摘）
      cesiumViewerManager.unregisterRenderErrorHandler()
    }
    expect(added.length).toBe(0)
    expect(removed.length).toBe(3)
  })
})

/** 相机防抖取消：3D→2D 切换路径不再让在途防抖空触发渲染 */
describe('相机防抖取消', () => {
  it('cancelPendingCameraDebounce 清掉在途定时器，且空定时器时调用安全', () => {
    // Object.create 绕过构造：new 会触发 _initViewer（需完整 Cesium 运行时），
    // 本用例只验证定时器语义，原型实例足够
    const renderer = Object.create(CesiumRenderer.prototype) as CesiumRenderer
    const store = renderer as unknown as {
      _cameraDebounceTimer: ReturnType<typeof setTimeout> | null
    }
    store._cameraDebounceTimer = setTimeout(() => {}, 10_000)
    renderer.cancelPendingCameraDebounce()
    expect(store._cameraDebounceTimer).toBeNull()
    // 幂等：无在途定时器时调用不抛
    expect(() => renderer.cancelPendingCameraDebounce()).not.toThrow()
  })
})

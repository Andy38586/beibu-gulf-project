// CesiumRenderer 水面测试
// 背景 1：06908b5 实现了 updateWaterLevel（曾复用 Primitive 仅替换 geometryInstances），
// 但 MapRenderer.hasLayer 只查 _layers，水面存于 _waterSurfaces → BLM.updateData
// 判据 !hasLayer(key) 恒真 → 每次水位变化都走 create（remove+add 全量重建），
// 增量代码是死代码。修复：CesiumRenderer 覆写 hasLayer 覆盖 _waterSurfaces。
// 背景 2（审查 H-1 回归）：「替换 geometryInstances」对 Cesium 状态机不成立——该属性
// 仅在构建期被读取，完成后运行时替换是纯 no-op，水面纹丝不动且旧测试只断言"可调用"，
// 把可疑路径固化成了能跑通。现实现为同步 remove+add 重建几何，本文件断言真实挂载语义。
import { describe, expect, it, vi } from 'vitest'

// 全量 mock cesium：Primitive 用可回读的普通对象（show 是公开可观测状态），
// 其余导出走共享工厂（避免递归 Proxy 在 vitest 模块加载期崩溃）
vi.mock('cesium', async () => {
  const { makeCesiumMock } = await import('./cesiumMock')
  return makeCesiumMock({
    Primitive: class TestPrimitive {
      show = true
    },
  })
})

import { Cartesian3 } from 'cesium'

import { BusinessLayerManager } from '../../BusinessLayerManager'
import { CesiumRenderer, doRemoveLayer, getViewportBBox } from '../CesiumRenderer'

function createRenderer(): CesiumRenderer {
  const container = { appendChild: vi.fn(), removeChild: vi.fn() } as unknown as HTMLElement
  return new CesiumRenderer(container)
}

/** 替换构造期 chainable Viewer：只暴露水面路径消费的 scene.primitives / requestRender */
function attachViewer(renderer: CesiumRenderer) {
  const added: Array<{ show: boolean }> = []
  const primitives = {
    add: vi.fn((primitive: { show: boolean }) => {
      added.push(primitive)
      return primitive
    }),
    remove: vi.fn(),
  }
  const requestRender = vi.fn()
  renderer.viewer = {
    isDestroyed: () => false,
    scene: { primitives, requestRender },
  } as unknown as CesiumRenderer['viewer']
  return { primitives, requestRender, added }
}

describe('CesiumRenderer.hasLayer 覆写（水面经公开 API 注册）', () => {
  it('addWaterSurface 后 hasLayer/isLayerVisible 均命中（基类只查 _layers 会漏）', async () => {
    const renderer = createRenderer()
    attachViewer(renderer)

    await expect(renderer.addWaterSurface('water-surface', [[108.5, 21.5]], 1)).resolves.toBe(true)

    expect(renderer.hasLayer('water-surface')).toBe(true)
    expect(renderer.isLayerVisible('water-surface')).toBe(true)
  })

  it('removeWaterSurface 后 hasLayer 回 false（账本随引擎摘除同步）', async () => {
    const renderer = createRenderer()
    const { primitives } = attachViewer(renderer)
    await renderer.addWaterSurface('water-surface', [[108.5, 21.5]], 1)

    expect(renderer.removeWaterSurface('water-surface')).toBe(true)
    expect(renderer.hasLayer('water-surface')).toBe(false)
    expect(primitives.remove).toHaveBeenCalledTimes(1)
  })

  it('未注册任何水面（_waterSurfaces 为 null）时查询不抛错且为 false', () => {
    const renderer = createRenderer()

    expect(renderer.hasLayer('water-surface')).toBe(false)
    expect(renderer.isLayerVisible('water-surface')).toBe(false)
  })

  it('setWaterSurfaceVisibility 改写水面权威可见性', async () => {
    const renderer = createRenderer()
    const { added } = attachViewer(renderer)
    await renderer.addWaterSurface('water-surface', [[108.5, 21.5]], 1)

    expect(renderer.setWaterSurfaceVisibility('water-surface', false)).toBe(true)
    expect(renderer.isLayerVisible('water-surface')).toBe(false)
    expect(added[0].show).toBe(false)
  })
})

describe('BLM.updateData 对已创建 waterSurface 走增量 update（不重建）', () => {
  it('hasLayer 命中（修复后语义）→ 调 updateWaterLevel 而非 addWaterSurface', () => {
    const renderer = {
      hasLayer: vi.fn(() => true),
      addWaterSurface: vi.fn(),
      updateWaterLevel: vi.fn(),
      removeWaterSurface: vi.fn(),
      setWaterSurfaceVisibility: vi.fn(),
      getType: () => '3d',
    }
    const store = {
      currentRenderer: renderer,
      layerCatalog: [] as unknown[],
      registerBusinessLayer: vi.fn(),
      setLayerVisible: vi.fn(),
      removeLayer: vi.fn(),
    }
    const blm = new BusinessLayerManager(store as never)

    blm.register('water-surface', {
      label: '水面',
      layerType: 'waterSurface',
      data: { coordinates: [[108.5, 21.5]], height: 1 },
      visible: true,
    })
    expect(renderer.addWaterSurface).toHaveBeenCalledTimes(1) // 注册时 create 一次

    // 水位变化 → updateData → 应走 update（增量），绝不二次 create（重建）
    blm.updateData('water-surface', {
      data: { coordinates: [[108.5, 21.5]], height: 5 },
    })
    expect(renderer.updateWaterLevel).toHaveBeenCalledTimes(1)
    expect(renderer.updateWaterLevel).toHaveBeenCalledWith('water-surface', 5)
    expect(renderer.addWaterSurface).toHaveBeenCalledTimes(1) // 仍是注册那一次
  })

  it('hasLayer 未命中（引擎切换后未重建）→ 走 create 补建（语义保留）', () => {
    const renderer = {
      hasLayer: vi.fn(() => false),
      addWaterSurface: vi.fn(),
      updateWaterLevel: vi.fn(),
      removeWaterSurface: vi.fn(),
      setWaterSurfaceVisibility: vi.fn(),
      getType: () => '3d',
    }
    const store = {
      currentRenderer: renderer,
      layerCatalog: [] as unknown[],
      registerBusinessLayer: vi.fn(),
      setLayerVisible: vi.fn(),
      removeLayer: vi.fn(),
    }
    const blm = new BusinessLayerManager(store as never)
    blm.register('water-surface', {
      label: '水面',
      layerType: 'waterSurface',
      data: { coordinates: [[108.5, 21.5]], height: 1 },
      visible: true,
    })
    blm.updateData('water-surface', {
      data: { coordinates: [[108.5, 21.5]], height: 5 },
    })
    expect(renderer.addWaterSurface).toHaveBeenCalledTimes(2) // 补建
    expect(renderer.updateWaterLevel).not.toHaveBeenCalled()
  })
})

describe('updateWaterLevel — 真实挂载语义：同步 remove+add 重建几何（审查 H-1 回归）', () => {
  async function setup(height: number) {
    const renderer = createRenderer()
    const { primitives, requestRender, added } = attachViewer(renderer)
    await renderer.addWaterSurface('water-surface', [[108.5, 21.5]], height)
    const oldPrimitive = added[0]
    primitives.add.mockClear()
    primitives.remove.mockClear()
    requestRender.mockClear()
    vi.mocked(Cartesian3.fromDegrees).mockClear()
    return { renderer, primitives, requestRender, added, oldPrimitive }
  }

  it('水位变化 → 移除旧 Primitive、挂载新 Primitive，新几何顶点含新水位', async () => {
    const { renderer, primitives, requestRender, oldPrimitive } = await setup(1)

    expect(renderer.updateWaterLevel('water-surface', 5)).toBe(true)

    // 旧实例被移除、新实例被挂载（替换 geometryInstances 的旧实现两者都不发生）
    expect(primitives.remove).toHaveBeenCalledTimes(1)
    expect(primitives.remove).toHaveBeenCalledWith(oldPrimitive)
    expect(primitives.add).toHaveBeenCalledTimes(1)
    const added = primitives.add.mock.calls[0][0]
    expect(added).not.toBe(oldPrimitive)

    // 账本同步指向新实例：第二次更新必须移除第一次挂上的新 Primitive
    expect(renderer.updateWaterLevel('water-surface', 10)).toBe(true)
    expect(primitives.remove).toHaveBeenLastCalledWith(added)

    // 几何按新高度重建：无真地形时基准 0 + 水位（旧实现替换属性后 Cesium 不再读取）
    expect(Cartesian3.fromDegrees).toHaveBeenCalledWith(108.5, 21.5, 5)

    // 按需渲染模式需显式请求一帧
    expect(requestRender.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('同值更新 → 跳过重建（滑块拖动触发同值）', async () => {
    const { renderer, primitives } = await setup(5)
    expect(renderer.updateWaterLevel('water-surface', 5)).toBe(true)
    expect(primitives.remove).not.toHaveBeenCalled()
    expect(primitives.add).not.toHaveBeenCalled()
  })

  it('id 不存在 → false 且不动场景', async () => {
    const { renderer, primitives } = await setup(1)
    expect(renderer.updateWaterLevel('nope', 5)).toBe(false)
    expect(primitives.remove).not.toHaveBeenCalled()
    expect(primitives.add).not.toHaveBeenCalled()
  })

  it('构建失败 → 旧 Primitive 原地保留（先建后换，不闪不消失）', async () => {
    const { renderer, primitives, oldPrimitive } = await setup(1)
    vi.mocked(Cartesian3.fromDegrees).mockImplementationOnce(() => {
      throw new Error('bad coordinate')
    })

    expect(renderer.updateWaterLevel('water-surface', 5)).toBe(false)
    expect(primitives.remove).not.toHaveBeenCalled()
    expect(primitives.add).not.toHaveBeenCalled()

    // 旧水位仍在：下一次成功更新仍从旧 Primitive 换起
    expect(renderer.updateWaterLevel('water-surface', 5)).toBe(true)
    expect(primitives.remove).toHaveBeenCalledWith(oldPrimitive)
  })
})

// 1004-03：43 处 `viewer!` 裸断言在引擎销毁（viewer=null）/空闲销毁（isDestroyed=true）
// 竞态下会以 TypeError 形态炸开且打断清理链。以下三条按行为钉 aliveViewer 守卫：
// 去掉守卫（回到 `viewer!`）本组即红——null 形态抛 TypeError、isDestroyed 形态误裁剪。
describe('1004-03 引擎存活守卫（viewer 失效 ⇒ 降级而非 TypeError）', () => {
  it('🔴 doRemoveLayer：viewer=null ⇒ 不抛错、监听引用置空、引擎侧调用不发生', () => {
    const renderer = createRenderer()
    renderer.viewer = null
    const layer = {
      instance: [{ id: 'a' }],
      visible: true,
      cameraListener: () => {},
      _viewportRafId: null,
    }

    expect(() => doRemoveLayer(renderer, layer as never)).not.toThrow()
    expect(layer.cameraListener).toBe(null)
  })

  it('🔴 getViewportBBox：viewer.isDestroyed()=true ⇒ 返回 null（不裁剪），不读已失效 camera', () => {
    const renderer = createRenderer()
    // 故意不提供 camera：旧代码判断过 `!renderer.viewer!` 后直接读 .camera.positionCartographic
    renderer.viewer = { isDestroyed: () => true } as never

    expect(getViewportBBox(renderer)).toBe(null)
  })

  it('🔴 setWaterSurfaceVisibility：viewer=null ⇒ 只改账本、不抛错', async () => {
    const renderer = createRenderer()
    const { added } = attachViewer(renderer)
    await renderer.addWaterSurface('w', [[108.5, 21.5]], 1)
    expect(renderer.setWaterSurfaceVisibility('w', false)).toBe(true)
    const [primitive] = added

    renderer.viewer = null
    expect(primitive.show).toBe(false)

    expect(() => renderer.setWaterSurfaceVisibility('w', true)).not.toThrow()
    expect(primitive.show).toBe(true)
    expect(renderer.isLayerVisible('w')).toBe(true)
  })
})

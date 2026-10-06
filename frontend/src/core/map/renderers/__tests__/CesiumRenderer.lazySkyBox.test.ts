// CesiumRenderer._scheduleLazySkyBox 行为测试（z038③：首进 3D 的 ≈850KB 星空资源懒加载）
// 判据：Viewer 以 skyBox:false 建成后，首帧之外经 idle 补建同一份 Cesium 自带星空；
// 已有星空不覆盖、viewer 已销毁不触碰、构造失败静默（星空非功能必需）。
import { describe, expect, it, vi } from 'vitest'

const skyBoxState = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  shouldThrow: false,
}))

vi.mock('cesium', async () => {
  const { makeCesiumMock } = await import('./cesiumMock')
  class MockSkyBox {
    constructor(options: Record<string, unknown>) {
      if (skyBoxState.shouldThrow) throw new Error('asset load failed')
      skyBoxState.calls.push(options)
    }
  }
  return makeCesiumMock({ SkyBox: MockSkyBox })
})

import { scheduleLazySkyBox } from '../../perf/cameraPerf'

/** 直接执行 rAF 回调，避免测试依赖 jsdom 帧计时 */
function runScheduledFrame(): void {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 0
  })
}

function makeViewer(overrides: Record<string, unknown> = {}) {
  const scene = {
    skyBox: false as unknown,
    requestRender: vi.fn(),
    ...(overrides.scene as object),
  }
  return {
    isDestroyed: () => false,
    scene,
    ...overrides,
  }
}

describe('CesiumRenderer._scheduleLazySkyBox（z038③ 星空懒加载）', () => {
  it('首帧后补建星空：6 面纹理齐全并触发一次重绘', () => {
    skyBoxState.calls.length = 0
    skyBoxState.shouldThrow = false
    runScheduledFrame()
    const viewer = makeViewer()
    scheduleLazySkyBox(viewer as never)
    expect(skyBoxState.calls).toHaveLength(1)
    const sources = skyBoxState.calls[0].sources as Record<string, string>
    expect(Object.keys(sources).sort()).toEqual(
      ['negativeX', 'negativeY', 'negativeZ', 'positiveX', 'positiveY', 'positiveZ'].sort()
    )
    expect(sources.positiveX).toContain('tycho2t3_80_px.jpg')
    expect(viewer.scene.skyBox).toBeTruthy()
    expect(viewer.scene.requestRender).toHaveBeenCalledTimes(1)
  })

  it('已有星空不覆盖（幂等：Viewer 复用/重复调度安全）', () => {
    skyBoxState.calls.length = 0
    runScheduledFrame()
    const viewer = makeViewer({ scene: { skyBox: { keep: true } } })
    scheduleLazySkyBox(viewer as never)
    expect(skyBoxState.calls).toHaveLength(0)
    expect(viewer.scene.skyBox).toEqual({ keep: true })
  })

  it('viewer 已销毁：不触碰、不抛错', () => {
    skyBoxState.calls.length = 0
    runScheduledFrame()
    const viewer = makeViewer({ isDestroyed: () => true })
    expect(() => scheduleLazySkyBox(viewer as never)).not.toThrow()
    expect(skyBoxState.calls).toHaveLength(0)
  })

  it('星空构造失败静默（非功能必需，不能影响 3D 主链）', () => {
    skyBoxState.calls.length = 0
    skyBoxState.shouldThrow = true
    runScheduledFrame()
    const viewer = makeViewer()
    expect(() => scheduleLazySkyBox(viewer as never)).not.toThrow()
    expect(viewer.scene.skyBox).toBe(false)
    skyBoxState.shouldThrow = false
  })
})

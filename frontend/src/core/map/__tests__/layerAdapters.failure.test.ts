import { describe, expect, it, vi } from 'vitest'

import { LAYER_ADAPTERS } from '../layerAdapters'

/**
 * 图层创建失败必须**上行**到 BLM（`options.onError`）的回归测试。
 *
 * 起因：`add3DTilesLayer` / `addImageOverlayLayer` 都用**返回值**表达失败
 * （不抛异常），而两个 adapter 原先把返回值整体丢弃、只在 `import.meta.env.DEV`
 * 下 warn 一句。结果是 BLM 注入的 onError 与 `_handleCreateFailure` 永不触发——
 * 图层开关显示"已开"、屏幕上没有东西，且生产环境连日志都没有（04-D2/D4）。
 *
 * 🔴 阳性对照：把 layerAdapters.ts 里 `if (!renderer.addImageOverlayLayer(...))`
 * 改回裸调用，本文件第 1 条即红；把 3dtiles 的 `.then((ok) => ok === false)` 分支
 * 删掉，第 3 条即红。
 */

function cesiumLike(overrides: Record<string, unknown> = {}) {
  return {
    getType: () => 'cesium',
    removeLayer: vi.fn(),
    addImageOverlayLayer: vi.fn(() => true),
    add3DTilesLayer: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  }
}

const IMAGE_DATA = { url: '/static/pinglu/imagery/madao.jpg', bbox: [1, 2, 3, 4], size: [10, 10] }
const TILES_DATA = { url: '/static/pinglu/tiles/tileset.json' }

describe('LAYER_ADAPTERS 的失败上行', () => {
  it('imageOverlay：渲染器返回 false 时调用 onError', () => {
    const onError = vi.fn()
    const renderer = cesiumLike({ addImageOverlayLayer: vi.fn(() => false) })
    LAYER_ADAPTERS.imageOverlay.create(renderer as never, 'img-1', IMAGE_DATA, { onError } as never)
    expect(renderer.addImageOverlayLayer).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
  })

  it('imageOverlay：成功时不得误报失败', () => {
    const onError = vi.fn()
    LAYER_ADAPTERS.imageOverlay.create(cesiumLike() as never, 'img-2', IMAGE_DATA, {
      onError,
    } as never)
    expect(onError).not.toHaveBeenCalled()
  })

  it('3dtiles：异步 resolve(false) 也要走 onError（不是只挂 .catch）', async () => {
    const onError = vi.fn()
    const renderer = cesiumLike({ add3DTilesLayer: vi.fn(() => Promise.resolve(false)) })
    LAYER_ADAPTERS['3dtiles'].create(renderer as never, 'tiles-1', TILES_DATA, { onError } as never)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
  })

  it('3dtiles：reject（网络/解析异常）同样上行', async () => {
    const onError = vi.fn()
    const boom = new Error('tileset 404')
    const renderer = cesiumLike({ add3DTilesLayer: vi.fn(() => Promise.reject(boom)) })
    LAYER_ADAPTERS['3dtiles'].create(renderer as never, 'tiles-2', TILES_DATA, { onError } as never)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(boom))
  })

  it('2D 渲染器无该能力 = 设计内跳过，**不得**报失败（02 §5.3 水面同款）', () => {
    const onError = vi.fn()
    const olLike = { getType: () => 'ol', removeLayer: vi.fn() } // 无两个能力方法
    LAYER_ADAPTERS.imageOverlay.create(olLike as never, 'img-3', IMAGE_DATA, {
      onError,
    } as never)
    LAYER_ADAPTERS['3dtiles'].create(olLike as never, 'tiles-3', TILES_DATA, {
      onError,
    } as never)
    expect(onError).not.toHaveBeenCalled()
  })

  it('数据形状不合格（缺 url）时静默跳过，不打扰用户', () => {
    const onError = vi.fn()
    const renderer = cesiumLike()
    LAYER_ADAPTERS['3dtiles'].create(renderer as never, 'tiles-4', {}, {
      onError,
    } as never)
    expect(renderer.add3DTilesLayer).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })
})

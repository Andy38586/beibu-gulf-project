import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { tolerantTileLoad } from '../baseTileSource'

/**
 * W48：OL 底图 XYZ 原先直接 `new XYZ({url})`——失败不重试、无并发上限。
 * 本套用例钉住补上的两条口径：失败重试恰好一次、并发槽位不超过 8。
 *
 * 注意：`tolerantTileLoad` 的槽位计数是模块级的，**每条用例必须自己释放**
 * （触发 load 或让 error 走到放弃分支），否则会污染后续用例。
 */

interface FakeImage {
  src: string
  addEventListener: (type: string, fn: () => void) => void
}

function fakeTile() {
  const listeners = new Map<string, Array<() => void>>()
  const image: FakeImage = {
    src: '',
    addEventListener: (type, fn) => {
      const list = listeners.get(type) ?? []
      list.push(fn)
      listeners.set(type, list)
    },
  }
  return {
    tile: { getImage: () => image } as never,
    image,
    fire: (type: string): void => {
      for (const fn of listeners.get(type) ?? []) fn()
    },
  }
}

describe('底图瓦片加载（W48）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('正常路径：取到槽位后把 src 交给 <img>', async () => {
    const { tile, image, fire } = fakeTile()
    tolerantTileLoad(tile, '/tile/1.png')
    await vi.advanceTimersByTimeAsync(0)
    expect(image.src).toBe('/tile/1.png')
    fire('load')
  })

  it('🔴 失败后 300ms 重试一次', async () => {
    const { tile, image, fire } = fakeTile()
    tolerantTileLoad(tile, '/tile/2.png')
    await vi.advanceTimersByTimeAsync(0)
    image.src = '' // 模拟浏览器在 error 后清空
    fire('error')

    await vi.advanceTimersByTimeAsync(299)
    expect(image.src).toBe('')
    await vi.advanceTimersByTimeAsync(1)
    expect(image.src).toBe('/tile/2.png')
    fire('load')
  })

  it('🔴 只重试一次：第二次 error 后不再重设 src', async () => {
    const { tile, image, fire } = fakeTile()
    tolerantTileLoad(tile, '/tile/3.png')
    await vi.advanceTimersByTimeAsync(0)
    fire('error')
    await vi.advanceTimersByTimeAsync(300)
    fire('error')
    image.src = ''
    await vi.advanceTimersByTimeAsync(1000)
    expect(image.src).toBe('')
  })

  it('🔴 并发槽位上限 8：第 9 张排队，前一张完成后才发', async () => {
    const tiles = Array.from({ length: 9 }, () => fakeTile())
    for (const [i, t] of tiles.entries()) tolerantTileLoad(t.tile, `/tile/c${i}.png`)
    await vi.advanceTimersByTimeAsync(0)

    const loadedFirst = tiles.slice(0, 8).filter((t) => t.image.src !== '')
    expect(loadedFirst).toHaveLength(8)
    expect(tiles[8].image.src).toBe('')

    // 释放一个槽位 ⇒ 第 9 张被放行
    tiles[0].fire('load')
    await vi.advanceTimersByTimeAsync(0)
    expect(tiles[8].image.src).toBe('/tile/c8.png')

    // 收尾：释放其余槽位，避免污染后续用例
    for (const t of tiles) t.fire('load')
  })
})

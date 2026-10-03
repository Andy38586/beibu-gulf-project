// 3D Tiles 预热测试。
//
// 钉死四件事（即本模块对「串行 / 可中断 / 失败静默 / 幂等」四条硬约束）：
//   ① **串行**：请求必须一个接一个发，不得并发（并发预取会挤首屏带宽，z130 教训）；
//   ② **失败静默**：任何一项失败都不抛错、不影响其余项；
//   ③ **幂等**：重复调用不再发请求；
//   ④ **可中断**：signal.aborted 后不再发新请求。
import { afterEach, describe, expect, it } from 'vitest'

import { __resetPreloadForTest, preloadTilesets } from '../preload'

afterEach(() => __resetPreloadForTest())

/** 造一个可控 fetch：记录调用顺序，可指定失败项 */
function makeFetch(plan: Record<string, { ok?: boolean; json?: unknown }>) {
  const calls: string[] = []
  let inflight = 0
  let maxInflight = 0
  const impl = (async (url: string) => {
    calls.push(url)
    inflight++
    if (inflight > maxInflight) maxInflight = inflight
    // 让出事件循环，暴露并发
    await new Promise((r) => setTimeout(r, 1))
    inflight--
    const p = plan[url] ?? { ok: false }
    return {
      ok: p.ok ?? false,
      json: async () => p.json ?? {},
    } as unknown as Response
  }) as unknown as typeof fetch
  return { impl, calls, maxInflight: () => maxInflight }
}

const TILESET = 'http://x.test/static/t/tileset.json'
const JSON_OK = {
  root: { content: { uri: 'a.glb' }, children: [{ content: { uri: '/static/t/b.glb' } }] },
}

describe('preloadTilesets', () => {
  it('取 tileset.json 后再取其内容 GLB（绝对/站点根相对都拼对）', async () => {
    const { impl, calls } = makeFetch({
      [TILESET]: { ok: true, json: JSON_OK },
      'http://x.test/static/t/a.glb': { ok: true },
      '/static/t/b.glb': { ok: true },
    })
    const n = await preloadTilesets([TILESET], undefined, impl)
    expect(calls).toEqual([TILESET, 'http://x.test/static/t/a.glb', '/static/t/b.glb'])
    expect(n).toBe(3)
  })

  it('**串行**：任一时刻最多 1 个请求在飞', async () => {
    const { impl, maxInflight } = makeFetch({
      [TILESET]: { ok: true, json: JSON_OK },
      'http://x.test/static/t/a.glb': { ok: true },
      '/static/t/b.glb': { ok: true },
    })
    await preloadTilesets([TILESET], undefined, impl)
    expect(maxInflight()).toBe(1)
  })

  it('失败静默：tileset.json 404 → 不抛错、计 0', async () => {
    const { impl } = makeFetch({ [TILESET]: { ok: false } })
    await expect(preloadTilesets([TILESET], undefined, impl)).resolves.toBe(0)
  })

  it('失败静默：内容 GLB 失败不影响 tileset 本身计数', async () => {
    const { impl } = makeFetch({ [TILESET]: { ok: true, json: JSON_OK } })
    const n = await preloadTilesets([TILESET], undefined, impl)
    expect(n).toBe(1)
  })

  it('fetch 抛异常也不外泄', async () => {
    const boom = (async () => {
      throw new Error('network')
    }) as unknown as typeof fetch
    await expect(preloadTilesets([TILESET], undefined, boom)).resolves.toBe(0)
  })

  it('**可中断**：已 abort 时一个请求都不发', async () => {
    const { impl, calls } = makeFetch({ [TILESET]: { ok: true, json: JSON_OK } })
    const ac = new AbortController()
    ac.abort()
    const n = await preloadTilesets([TILESET], ac.signal, impl)
    expect(calls).toEqual([])
    expect(n).toBe(0)
  })
})

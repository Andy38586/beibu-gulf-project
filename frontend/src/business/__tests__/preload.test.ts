// 3D Tiles 预热测试。
//
// 钉死五件事（即本模块对「串行 / 可中断 / 失败静默 / 幂等」四条硬约束 + 派生感知）：
//   ① **串行**：请求必须一个接一个发，不得并发（并发预取会挤首屏带宽，z130 教训）；
//   ② **失败静默**：任何一项失败都不抛错、不影响其余项；
//   ③ **幂等**：重复调用不再发请求；
//   ④ **可中断**：signal.aborted 后不再发新请求；
//   ⑤ **派生感知**（2026-10-04 23:4x）：只预热派生后仍在树上的内容——按原始清单预热会把
//      `dropContent`/球外裁剪后**永远不会渲染**的内容也拖下来（港区实测 ≈118 MB 纯浪费）。
import { afterEach, describe, expect, it } from 'vitest'

import {
  BEIBU_TILES,
  prepareBeibuTileset,
  type BeibuTilesSpec,
} from '@/business/route-analysis/constants/beibu3dTiles'

import { __resetPreloadForTest, preloadTilesets } from '../preload'

afterEach(() => __resetPreloadForTest())

/** 造一个可控 fetch：记录"方法 + URL"调用顺序，可指定失败项与 content-length（HEAD 用） */
function makeFetch(
  plan: Record<string, { ok?: boolean; json?: unknown; size?: number; noHeaders?: boolean }>
) {
  const calls: string[] = []
  let inflight = 0
  let maxInflight = 0
  const impl = (async (url: string, init?: { method?: string }) => {
    calls.push((init?.method ?? 'GET') + ' ' + url)
    inflight++
    if (inflight > maxInflight) maxInflight = inflight
    // 让出事件循环，暴露并发
    await new Promise((r) => setTimeout(r, 1))
    inflight--
    // 查表：精确 key 优先；`*` 前缀做后缀通配（派生后的 uri origin 由 resolveUri 决定，
    // 测试里不想写死 origin）
    let p = plan[url]
    if (!p) {
      for (const k of Object.keys(plan)) {
        if (k.startsWith('*') && url.endsWith(k.slice(1))) {
          p = plan[k]
          break
        }
      }
    }
    p = p ?? { ok: false }
    const headers = p.noHeaders
      ? undefined
      : {
          get: (k: string) =>
            k.toLowerCase() === 'content-length' && p.size != null ? String(p.size) : null,
        }
    return {
      ok: p.ok ?? false,
      json: async () => p.json ?? {},
      headers,
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
    const n = await preloadTilesets([{ url: TILESET }], undefined, impl)
    expect(calls).toEqual([
      'GET ' + TILESET,
      'HEAD http://x.test/static/t/a.glb',
      'GET http://x.test/static/t/a.glb',
      'HEAD /static/t/b.glb',
      'GET /static/t/b.glb',
    ])
    expect(n).toBe(3)
  })

  it('**单项超限**：HEAD 报 50 MB ⇒ 跳过该内容（不发 GET、不计入 ok）', async () => {
    const { impl, calls } = makeFetch({
      [TILESET]: { ok: true, json: JSON_OK },
      'http://x.test/static/t/a.glb': { ok: true, size: 50 * 1024 * 1024 },
      '/static/t/b.glb': { ok: true },
    })
    const n = await preloadTilesets([{ url: TILESET }], undefined, impl)
    expect(calls).not.toContain('GET http://x.test/static/t/a.glb')
    expect(calls).toContain('GET /static/t/b.glb')
    expect(n).toBe(2)
  })

  it('HEAD 无 content-length ⇒ 保守放行（照常取）', async () => {
    const { impl, calls } = makeFetch({
      [TILESET]: { ok: true, json: JSON_OK },
      'http://x.test/static/t/a.glb': { ok: true, noHeaders: true },
      '/static/t/b.glb': { ok: true },
    })
    const n = await preloadTilesets([{ url: TILESET }], undefined, impl)
    expect(calls).toContain('GET http://x.test/static/t/a.glb')
    expect(n).toBe(3)
  })

  it('**串行**：任一时刻最多 1 个请求在飞', async () => {
    const { impl, maxInflight } = makeFetch({
      [TILESET]: { ok: true, json: JSON_OK },
      'http://x.test/static/t/a.glb': { ok: true },
      '/static/t/b.glb': { ok: true },
    })
    await preloadTilesets([{ url: TILESET }], undefined, impl)
    expect(maxInflight()).toBe(1)
  })

  it('失败静默：tileset.json 404 → 不抛错、计 0', async () => {
    const { impl } = makeFetch({ [TILESET]: { ok: false } })
    await expect(preloadTilesets([{ url: TILESET }], undefined, impl)).resolves.toBe(0)
  })

  it('失败静默：内容 GLB 失败不影响 tileset 本身计数', async () => {
    const { impl } = makeFetch({ [TILESET]: { ok: true, json: JSON_OK } })
    const n = await preloadTilesets([{ url: TILESET }], undefined, impl)
    expect(n).toBe(1)
  })

  it('fetch 抛异常也不外泄', async () => {
    const boom = (async () => {
      throw new Error('network')
    }) as unknown as typeof fetch
    await expect(preloadTilesets([{ url: TILESET }], undefined, boom)).resolves.toBe(0)
  })

  it('**可中断**：已 abort 时一个请求都不发', async () => {
    const { impl, calls } = makeFetch({ [TILESET]: { ok: true, json: JSON_OK } })
    const ac = new AbortController()
    ac.abort()
    const n = await preloadTilesets([{ url: TILESET }], ac.signal, impl)
    expect(calls).toEqual([])
    expect(n).toBe(0)
  })

  // ---- 派生感知（2026-10-04 23:4x）：只预热派生后仍在树上的内容 ----
  const PORT = BEIBU_TILES.find((s) => s.id === 'qinzhou-port') as BeibuTilesSpec
  const SPHERE = PORT.derive!.keepSphere!

  /** 港区形状的最小夹具：根壳 + 球内 d2（内容会被摘）+ 球内 d4（保留）+ 球外 d4（整棵剔除） */
  function makePortRaw(): unknown {
    const leaf = (uri: string, depth: number, dx: number) => ({
      content: { uri },
      extras: { depth },
      geometricError: 0,
      boundingVolume: {
        box: [
          SPHERE.center[0] + dx,
          SPHERE.center[1],
          SPHERE.center[2],
          200,
          0,
          0,
          0,
          200,
          0,
          0,
          0,
          10,
        ],
      },
    })
    return {
      asset: { version: '1.1' },
      geometricError: 512,
      root: {
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        boundingVolume: { box: [0, 0, 0, 9000, 0, 0, 0, 9000, 0, 0, 0, 50] },
        geometricError: 256,
        refine: 'REPLACE',
        content: { uri: 't0_0_0.glb' },
        extras: { depth: 0 },
        children: [
          {
            ...leaf('t2_near.glb', 2, 250),
            geometricError: 64,
            children: [leaf('t4_near.glb', 4, 300)],
          },
          leaf('t4_far.glb', 4, 5000),
        ],
      },
    }
  }

  it('**派生感知**：被 dropContent 摘空 / 球外剔除的内容不预热', async () => {
    // 注意：derive 用的基准是 **spec.url**（与注册路径同一函数、同一基准），
    // 故派生出的 uri 是站点根相对 '/static/qinzhou-port/tiles/…'，不是上面测试用的 x.test 域。
    const U = (f: string) => '/static/qinzhou-port/tiles/' + f
    const { impl, calls } = makeFetch({
      [TILESET]: { ok: true, json: makePortRaw() },
      ['*' + U('t0_0_0.glb')]: { ok: true },
      ['*' + U('t4_near.glb')]: { ok: true },
      ['*' + U('t2_near.glb')]: { ok: true },
      ['*' + U('t4_far.glb')]: { ok: true },
    })
    const n = await preloadTilesets(
      [{ url: TILESET, prepare: (raw) => prepareBeibuTileset(raw, PORT) }],
      undefined,
      impl
    )
    // 只看文件名（origin 由 resolveUri 决定：有 location 时绝对化到当前 origin，测试环境也一样）
    const fetched = calls.filter((c) => c.startsWith('GET ')).map((c) => c.split('/').pop())
    // 根壳与球内精细层在派生后仍在树上 ⇒ 预热
    expect(fetched).toContain('t0_0_0.glb')
    expect(fetched).toContain('t4_near.glb')
    // 粗层内容被摘、球外整棵剔除 ⇒ 一个字节都不发（≈118 MB 浪费的消除处）
    expect(fetched).not.toContain('t2_near.glb')
    expect(fetched).not.toContain('t4_far.glb')
    expect(n).toBe(3) // tileset + 2 个内容 GLB
  })

  it('派生结果为空（裁空）⇒ 不取任何内容、也不计 tileset', async () => {
    const { impl, calls } = makeFetch({
      [TILESET]: { ok: true, json: JSON_OK },
      'http://x.test/static/t/a.glb': { ok: true },
      '/static/t/b.glb': { ok: true },
    })
    const n = await preloadTilesets([{ url: TILESET, prepare: () => null }], undefined, impl)
    expect(calls).toEqual(['GET ' + TILESET])
    expect(n).toBe(0)
  })
})

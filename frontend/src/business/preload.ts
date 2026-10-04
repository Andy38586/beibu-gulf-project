/**
 * 业务资产预热（2026-10-03）。
 *
 * ## 为什么需要
 *
 * 3D Tiles **不在首屏**：路由 `/` 是 HomePage（2d），RouteAnalysisPage 是
 * `buildBusinessRoutes()` 出来的懒加载路由。所以「首屏字节」这个口径对它没有意义——
 * 用户原话：「3d又不在首屏加载？这个进预热队列吧」——编号与裁定过程见台账。
 *
 * 既有预热队列在 `shared/utils/warmupAfterFirstFrame`（首帧 → requestIdleCallback），
 * `App.vue` 目前只挂了 Cesium 脚本。本模块是队列的**第二项**：把 3D Tiles 的
 * 瓦片集与内容 GLB 按需取进 HTTP 缓存，让「切到 3D」那一刻不再等网络。
 *
 * ## 硬约束（对应指标 C5）
 *
 * - **串行**：逐项 `await`，不与 Cesium 的 5.8 MB 抢带宽（z130 的教训：
 *   并发预取把首屏瓦片挤回退）；
 * - **可中断**：接受 `AbortSignal`，页面切走即停；
 * - **失败静默**：预热只是优化，任何一项失败都不影响功能（正式路径自会按需加载）；
 * - **幂等**：模块级 once 标志，重复调用不再发请求。
 *
 * ## 为什么不在这里硬编码 tileset 清单
 *
 * 清单的权威源是 `business/route-analysis/constants/beibu3dTiles`（图层面板也从它读）。
 * 本模块只接受 URL 列表，由调用方传入——避免「同一份名单两处手抄」（04-F）。
 */
import { BEIBU_TILES } from '@/business/route-analysis/constants/beibu3dTiles'

/** 预热一项的字节上限：超过就跳过（C5「单项 ≤ 40 MB」的落地） */
export const PRELOAD_ITEM_LIMIT_BYTES = 40 * 1024 * 1024

let done = false

/** 从 tileset JSON 里抽出所有 content.uri（只取一层 children，够覆盖本项目的三层结构） */
function collectContentUris(json: unknown): string[] {
  const out: string[] = []
  const walk = (n: { content?: { uri?: string }; children?: unknown[] }): void => {
    const uri = n?.content?.uri
    if (typeof uri === 'string') out.push(uri)
    for (const c of (n?.children ?? []) as { content?: { uri?: string }; children?: unknown[] }[])
      walk(c)
  }
  const root = (json as { root?: { content?: { uri?: string }; children?: unknown[] } })?.root
  if (root) walk(root)
  return out
}

/**
 * 串行预热给定的 tileset：先取 tileset.json，再取其内容 GLB。
 *
 * @returns 实际取到的项数（供测试断言；失败项不计入且不抛错）
 */
/**
 * 取单项字节数（HEAD）。拿不到 `content-length` 或 HEAD 失败时返回 `null`
 * —— 保守放行（不把没给头信息的服务器整项跳过），由调用方决定。
 */
async function headBytes(
  url: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal
): Promise<number | null> {
  try {
    const r = await fetchImpl(url, { method: 'HEAD', signal })
    const raw = r.headers?.get?.('content-length')
    const n = raw == null ? NaN : Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : null
  } catch {
    return null
  }
}

export async function preloadTilesets(
  urls: readonly string[],
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch
): Promise<number> {
  let ok = 0
  for (const url of urls) {
    if (signal?.aborted) break
    try {
      const res = await fetchImpl(url, { signal })
      if (!res.ok) continue
      const json = await res.json()
      ok++
      const base = url.slice(0, url.lastIndexOf('/') + 1)
      for (const uri of collectContentUris(json)) {
        if (signal?.aborted) break
        // 已是绝对地址的原样用；站点根相对补 origin；其余拼基准目录
        const abs = /^[a-z][a-z0-9+.-]*:/i.test(uri) ? uri : uri.startsWith('/') ? uri : base + uri
        // C5「单项 ≤ 40 MB」的执行体：超限项跳过预热（正式路径仍会在需要时按需加载）
        const size = await headBytes(abs, fetchImpl, signal)
        if (size !== null && size > PRELOAD_ITEM_LIMIT_BYTES) continue
        try {
          const r2 = await fetchImpl(abs, { signal })
          if (r2.ok) ok++
        } catch {
          /* 单项失败静默 */
        }
      }
    } catch {
      /* 单项失败静默——预热失败不影响功能 */
    }
  }
  return ok
}

/** 预热本页 3D Tiles 资产（幂等）。供 warmupAfterFirstFrame 调用。 */
export async function preloadBusinessAssets(signal?: AbortSignal): Promise<number> {
  if (done) return 0
  done = true
  return preloadTilesets(
    BEIBU_TILES.map((s) => s.url),
    signal
  )
}

/** 仅供测试重置幂等标志 */
export function __resetPreloadForTest(): void {
  done = false
}

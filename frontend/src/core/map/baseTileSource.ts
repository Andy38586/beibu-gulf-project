import type { Tile } from 'ol'
import XYZ from 'ol/source/XYZ'

/**
 * 底图瓦片源（W48）：OL 的 `XYZ` 默认**无并发上限、失败不重试、无缓存调优**，
 * 而 Cesium 侧三项齐备（`maximumScreenSpaceError` / `tileCacheSize` / 失败重试）。
 * 底图是弱网首屏第一瓶颈：一张失败瓦片会空白到下次缩放才恢复。
 *
 * 三项口径：
 * - **并发 ≤ 8**：OL 无内置并发控制（浏览器每域名 6 连接只是兜底，且不排队）。
 *   超出的瓦片进队列，槽位释放后立即加载。
 * - **失败重试 1 次**（300ms 后）：仍失败则放弃——无限重试会刷爆天地图配额。
 * - **不加 LRU**：OL 的 TileQueue 已按视野回收瓦片，再叠一层会与它的回收冲突。
 *
 * 槽位看门狗：被 OL 取消的瓦片可能既不 load 也不 error，15s 后强制归还槽位，
 * 避免队列被永久占满（这是本文件唯一非显然的取舍）。
 */
const MAX_PARALLEL_TILE_LOADS = 8
const RETRY_DELAY_MS = 300
const SLOT_WATCHDOG_MS = 15_000

let activeLoads = 0
const waiting: Array<() => void> = []

function acquireSlot(): Promise<void> {
  if (activeLoads < MAX_PARALLEL_TILE_LOADS) {
    activeLoads += 1
    return Promise.resolve()
  }
  return new Promise((resolve) => waiting.push(resolve))
}

function releaseSlot(): void {
  const next = waiting.shift()
  if (next) next()
  else activeLoads -= 1
}

/**
 * 取代 OL 默认的「直接设 image.src」：同一 `src` 失败后重试一次，并让全局限流生效。
 */
export function tolerantTileLoad(tile: Tile, src: string): void {
  // XYZ 的 tileLoadFunction 声明在基类 Tile 上，运行期传的是 ImageTile（带 getImage）
  const image = (tile as Tile & { getImage(): HTMLImageElement }).getImage()
  let retried = false
  let released = false

  const release = (): void => {
    if (released) return
    released = true
    releaseSlot()
  }
  const load = (): void => {
    image.src = src
  }

  image.addEventListener('load', release, { once: true })
  image.addEventListener('error', () => {
    if (retried) {
      release()
      return
    }
    retried = true
    setTimeout(load, RETRY_DELAY_MS)
  })

  void acquireSlot().then(() => {
    setTimeout(release, SLOT_WATCHDOG_MS)
    load()
  })
}

/** 底图 XYZ 源的唯一构造口径（影像/矢量两处共用，防两处配置漂移） */
export function createBaseTileSource(url: string): XYZ {
  return new XYZ({
    url,
    crossOrigin: 'anonymous',
    tileLoadFunction: tolerantTileLoad,
  })
}

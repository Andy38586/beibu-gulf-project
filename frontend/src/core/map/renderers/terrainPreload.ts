/**
 * 地形预热：串行在 Cesium 预热完成之后执行（不与 5.7MB 主库抢带宽）。
 * 预取 /static/terrain/layer.json + 低层瓦片——浏览器 HTTP 缓存命中后，
 * 首次进 3D 的 CesiumTerrainProvider.fromUrl 近乎秒开（正式路径 CesiumRenderer._setupTerrain）。
 * 失败静默：预热只是优化手段，不阻断、不重试，进 3D 时自会按需加载。
 */

/** layer.json（tilejson heightmap-1.0）预热所需字段 */
interface TerrainLayerJson {
  /** 瓦片 URL 模板，如 /static/terrain/{z}/{x}/{y}.terrain?v={version} */
  tiles?: string[]
  version?: string
  /** available[zoom] = 该层瓦片范围数组（heightmap-1.0 available 结构） */
  available?: Array<Array<{ startX: number; startY: number; endX: number; endY: number }>>
}

/** 低层瓦片预取上限：0~3 层全量仅几十个文件，上限兜底防御异常 layer.json（如范围写爆） */
const MAX_PREHEAT_TILES = 64

/**
 * 由 layer.json 收集 0~maxZoom 层瓦片 URL（可导出单测：URL 拼装与上限逻辑零副作用）。
 *
 * ⚠ **available 的 y 是 TMS（从南数），URL/文件名是 slippy（从北数）——必须翻 y**。
 * 2026-10-04 运行时实测：漏翻时预热请求的是镜像位置（z2 求 `2/6/2`、z3 求 `3/12/4..5`），
 * 全部 404（真值在 `2/6/1`、`3/12/3/2`），预热对 z2/z3 完全空转、还白打 5 个 404。
 * CesiumTerrainProvider 自己会翻（实测 isTileAvailable 对盘上位置返回 true），
 * 故本函数是"按 available 拼 URL"的消费者里唯一需要自己翻的一处。
 */
export function collectTerrainTileUrls(layer: TerrainLayerJson, maxZoom: number): string[] {
  const template = layer.tiles?.[0] ?? '/static/terrain/{z}/{x}/{y}.terrain'
  const version = layer.version ?? ''
  const available = Array.isArray(layer.available) ? layer.available : []
  const urls: string[] = []
  for (let z = 0; z <= maxZoom && z < available.length; z++) {
    const ranges = Array.isArray(available[z]) ? available[z] : []
    const rows = 2 ** z
    for (const range of ranges) {
      for (let x = range.startX; x <= range.endX; x++) {
        for (let y = range.startY; y <= range.endY; y++) {
          if (urls.length >= MAX_PREHEAT_TILES) return urls
          const ySlippy = rows - 1 - y
          urls.push(
            template
              .replace('{z}', String(z))
              .replace('{x}', String(x))
              .replace('{y}', String(ySlippy))
              .replace('{version}', version)
          )
        }
      }
    }
  }
  return urls
}

// @arch-note 此处不走 loadStatic 统一入口：预取物是 heightmap-1.0 的二进制 .terrain
// 瓦片（非 JSON），loadStatic 会强制 JSON.parse 而失败；且预热只需"让浏览器 HTTP 缓存
// 命中"，丢弃响应体、无解析/校验/超时语义需求。故保留裸 fetch 并显式登记例外。
/** 地形预热入口：layer.json + 低层瓦片并行预取；任何失败静默返回 */
export async function preloadTerrain(maxZoom = 3): Promise<void> {
  try {
    const res = await fetch('/static/terrain/layer.json')
    if (!res.ok) return
    const layer = (await res.json()) as TerrainLayerJson
    await Promise.all(
      collectTerrainTileUrls(layer, maxZoom).map((url) => fetch(url).catch(() => undefined))
    )
  } catch {
    // 预热失败静默——进 3D 时走正式加载路径（_setupTerrain）
  }
}

// @vitest-environment jsdom
/**
 * collectTerrainTileUrls 单测：锁定 layer.json（heightmap-1.0）→ 低层瓦片 URL 的拼装契约。
 * 预热链路（preloadCesium → preloadTerrain）依赖 URL 与真实瓦片目录一致，拼错 = 预热全空转。
 */
import { describe, expect, it } from 'vitest'

import { collectTerrainTileUrls } from '../terrainPreload'

/**
 * 与 backend/static/terrain/layer.json 同构的最小样例（z0~z3 各一档范围）。
 * ⚠ 数值口径：available 的 y 是 **TMS（从南数）**，与盘上/URL 的 slippy（从北数）互为
 * `rows-1-y`——用真实 layer.json 的 z2 `(6,2)`、z3 `(12,4..5)` 做锚点（2026-10-04 实测：
 * 漏翻时预热的正是这两处在盘上不存在的镜像，5 张全 404）。
 */
const sampleLayer = {
  tilejson: '2.1.0',
  version: '1.1.0',
  format: 'heightmap-1.0',
  schema: 'tms',
  tiles: ['/static/terrain/{z}/{x}/{y}.terrain?v={version}'],
  available: [
    [{ startX: 1, startY: 0, endX: 1, endY: 0 }],
    [{ startX: 3, startY: 1, endX: 3, endY: 1 }],
    [{ startX: 6, startY: 2, endX: 6, endY: 2 }],
    [{ startX: 12, startY: 4, endX: 12, endY: 5 }],
  ],
}

describe('collectTerrainTileUrls', () => {
  it('按 available 展开范围并替换 z/x/y/version', () => {
    const urls = collectTerrainTileUrls(sampleLayer, 3)
    expect(urls).toContain('/static/terrain/0/1/0.terrain?v=1.1.0')
    // TMS → slippy：z1 rows=2，y 1→0
    expect(urls).toContain('/static/terrain/1/3/0.terrain?v=1.1.0')
    // z3 rows=8：startY=4..5 → slippy 3..2，展开为 2 片
    expect(urls).toContain('/static/terrain/3/12/3.terrain?v=1.1.0')
    expect(urls).toContain('/static/terrain/3/12/2.terrain?v=1.1.0')
    expect(urls).toHaveLength(5)
  })

  it('回归：z2/z3 必须请求盘上实物而非镜像（2026-10-04 实跑 5×404 的地址不得出现）', () => {
    const urls = collectTerrainTileUrls(sampleLayer, 3)
    // 漏翻时发出的镜像地址（盘上不存在，实测 404）——修复后必须一个都没有
    for (const mirror of [
      '/static/terrain/2/6/2.terrain?v=1.1.0',
      '/static/terrain/3/12/4.terrain?v=1.1.0',
      '/static/terrain/3/12/5.terrain?v=1.1.0',
    ]) {
      expect(urls).not.toContain(mirror)
    }
    // 盘上实物（实测 200）——必须被预热到
    expect(urls).toContain('/static/terrain/2/6/1.terrain?v=1.1.0')
    expect(urls).toContain('/static/terrain/3/12/3.terrain?v=1.1.0')
    expect(urls).toContain('/static/terrain/3/12/2.terrain?v=1.1.0')
  })

  it('maxZoom 截断：只收 0~maxZoom 层', () => {
    const urls = collectTerrainTileUrls(sampleLayer, 1)
    expect(urls).toHaveLength(2)
    expect(
      urls.every((u) => u.startsWith('/static/terrain/0/') || u.startsWith('/static/terrain/1/'))
    ).toBe(true)
  })

  it('tiles 模板缺失时回退默认路径', () => {
    const urls = collectTerrainTileUrls(
      { available: [[{ startX: 0, startY: 0, endX: 0, endY: 0 }]] },
      0
    )
    expect(urls).toEqual(['/static/terrain/0/0/0.terrain'])
  })

  it('available 缺失/畸形返回空数组（防御异常 layer.json）', () => {
    expect(collectTerrainTileUrls({}, 3)).toEqual([])
    expect(collectTerrainTileUrls({ available: [undefined as never] }, 3)).toEqual([])
  })

  it('范围写爆时按 64 上限截断（不 hammer 服务端）', () => {
    const wild = {
      tiles: ['/static/terrain/{z}/{x}/{y}.terrain'],
      available: [[{ startX: 0, startY: 0, endX: 999, endY: 999 }]],
    }
    expect(collectTerrainTileUrls(wild, 0)).toHaveLength(64)
  })
})

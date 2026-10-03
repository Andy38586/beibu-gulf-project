// 钦州港 3D Tiles 清单与预处理路径测试。
//
// 钉死三件事：
//   ① **分支落在行为上**：清单声明 derive 的条目走裁剪、没声明的走整包——
//      删掉 prepareBeibuTileset 里的裁剪分支，下面「球外节点消失」的断言必红。
//      （不用源码子串断言：04-F 禁止把源码文本当判据。）
//   ② **粗层只摘内容不删节点**：钦州港 d0~d3 是 d4/d5 的唯一通路，
//      误用 drop（连子树删）会让集装箱/龙门架整棵消失。
//   ③ **裁剪球参数是有据的**：中心/半径来自交付包实测，不是拍的。
import { describe, expect, it } from 'vitest'

import type { TilesetJson, TilesetNode } from '@/core/map/tiles3dGroups'

import {
  BEIBU_TILES,
  QINZHOU_COARSE_MAX_DEPTH,
  QINZHOU_OPERATION_AREA,
  isCoarseTerrainLayer,
  prepareBeibuTileset,
  type BeibuTilesSpec,
} from '../beibu3dTiles'

const QINZHOU = BEIBU_TILES.find((s) => s.id === 'qinzhou-port') as BeibuTilesSpec
const TERMINAL = BEIBU_TILES.find((s) => s.id === 'qz-terminal-bim') as BeibuTilesSpec

/** 造一棵「作业区内 d4 精细瓦片 + 球外 5km 的 d4 瓦片 + 覆盖全场的 d0 粗层」的树 */
function makeTileset(): TilesetJson {
  const c = QINZHOU_OPERATION_AREA.center
  const leaf = (tile: string, depth: number, dx: number): TilesetNode => ({
    content: { uri: tile + '.glb' },
    extras: { tile, depth },
    geometricError: 0,
    boundingVolume: { box: [c[0] + dx, c[1], c[2], 200, 0, 0, 0, 200, 0, 0, 0, 10] },
  })
  return {
    asset: { version: '1.1', generator: 'test' },
    geometricError: 512,
    root: {
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      boundingVolume: { box: [0, 0, 0, 9000, 0, 0, 0, 9000, 0, 0, 0, 50] },
      geometricError: 256,
      refine: 'REPLACE',
      content: { uri: 't0_0_0.glb' },
      extras: { tile: 't0_0_0', depth: 0 },
      children: [leaf('t4_near', 4, 300), leaf('t4_far', 4, 5000)],
    },
  }
}

describe('BEIBU_TILES 清单', () => {
  it('六条资产，id 唯一且与类型联合一致', () => {
    expect(BEIBU_TILES).toHaveLength(6)
    const ids = BEIBU_TILES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([
      'pinglu-canal',
      'qinzhou-port',
      'qz-containers',
      'qz-roads',
      'qz-city-bridges',
      'qz-terminal-bim',
    ])
  })

  it('四条资产的 url 两两不同（指同一个 tileset 就是同一位置渲染两套）', () => {
    const urls = BEIBU_TILES.map((s) => s.url)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('作业区层指向清空版、集装箱层指向重建版（两者不得指同一个 tileset）', () => {
    expect(QINZHOU.url).toBe('/static/qinzhou-port/rebuilt/tileset.cleaned.json')
    const containers = BEIBU_TILES.find((s) => s.id === 'qz-containers')!
    expect(containers.url).toBe('/static/qinzhou-port/rebuilt/tileset.json')
    expect(containers.url).not.toBe(QINZHOU.url)
    // 集装箱层不需要再裁：生成时已按作业区半径筛过箱区
    expect(containers.derive).toBeUndefined()
  })

  it('url 均为站点根绝对路径（Data URI 挂载前由派生补 origin）', () => {
    for (const s of BEIBU_TILES) expect(s.url.startsWith('/static/')).toBe(true)
  })

  it('只有钦州港核心区声明裁剪；码头 BIM 走整包', () => {
    expect(QINZHOU.derive).toBeDefined()
    expect(TERMINAL.derive).toBeUndefined()
  })
})

describe('QINZHOU_OPERATION_AREA — 裁剪球', () => {
  it('半径为正、中心为三元组', () => {
    expect(QINZHOU_OPERATION_AREA.radius).toBeGreaterThan(0)
    expect(QINZHOU_OPERATION_AREA.center).toHaveLength(3)
    for (const v of QINZHOU_OPERATION_AREA.center) expect(Number.isFinite(v)).toBe(true)
  })

  it('中心落在交付包包围盒内（局部 ENU，半轴 8078×9022）', () => {
    const [e, n] = QINZHOU_OPERATION_AREA.center
    expect(Math.abs(e)).toBeLessThan(8078)
    expect(Math.abs(n)).toBeLessThan(9022)
  })
})

describe('isCoarseTerrainLayer — 粗层判据', () => {
  it('depth ≤ 3 ⇒ 粗层（摘内容）；d4/d5 ⇒ 地物（保留）', () => {
    for (let d = 0; d <= QINZHOU_COARSE_MAX_DEPTH; d++) {
      expect(isCoarseTerrainLayer({ extras: { depth: d } })).toBe(true)
    }
    expect(isCoarseTerrainLayer({ extras: { depth: 4 } })).toBe(false)
    expect(isCoarseTerrainLayer({ extras: { depth: 5 } })).toBe(false)
  })

  it('无 depth 字段一律不判为粗层（宁多留不误删）', () => {
    expect(isCoarseTerrainLayer({})).toBe(false)
    expect(isCoarseTerrainLayer({ extras: {} })).toBe(false)
    expect(isCoarseTerrainLayer({ extras: { depth: '3' } })).toBe(false)
  })
})

describe('prepareBeibuTileset — 清单驱动的分支（行为判据）', () => {
  it('声明 derive 的条目：球外子树消失、球内保留、粗层被摘内容', () => {
    const out = prepareBeibuTileset(makeTileset(), QINZHOU)
    expect(out).not.toBeNull()
    const tiles = (out!.root.children ?? []).map((c) => String(c.extras?.tile))
    expect(tiles).toContain('t4_near')
    // 球外 5 km 的瓦片被整棵剔除——删掉裁剪分支这条必红
    expect(tiles).not.toContain('t4_far')
    // 粗层节点还在（是精细瓦片的通路），但内容已摘
    expect(out!.root.content).toBeUndefined()
    // uri 绝对化（Data URI 挂载前必需）
    expect(out!.root.children![0].content!.uri).toContain('/static/')
  })

  it('未声明 derive 的条目：整棵树原样保留（含球外瓦片与 root 内容）', () => {
    const out = prepareBeibuTileset(makeTileset(), TERMINAL)
    expect(out).not.toBeNull()
    const tiles = (out!.root.children ?? []).map((c) => String(c.extras?.tile))
    expect(tiles).toContain('t4_far')
    expect(out!.root.content).toBeDefined()
  })

  it('裁剪后无内容 ⇒ 返回 null（不挂空瓦片集）', () => {
    const spec: BeibuTilesSpec = {
      ...QINZHOU,
      derive: { keepSphere: { center: [1e7, 0, 0], radius: 1 } },
    }
    expect(prepareBeibuTileset(makeTileset(), spec)).toBeNull()
  })
})

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
  shouldDropPortContent,
  type BeibuTilesSpec,
} from '../beibu3dTiles'

const QINZHOU = BEIBU_TILES.find((s) => s.id === 'qinzhou-port') as BeibuTilesSpec
/** 未声明 derive 的条目（走整包路径）——取城区五桥，它确实是整包挂载 */
const WHOLE = BEIBU_TILES.find((s) => s.id === 'qz-city-bridges') as BeibuTilesSpec

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
      children: [
        // 中粗层（depth 2）带内容：用来证明"摘内容"确实作用在 d1~d3 上，而不只是没节点
        {
          ...leaf('t2_near', 2, 250),
          geometricError: 64, // 被摘空的层要带真实 GE，否则 cap 无可压之值（见下条断言）
          children: [leaf('t4_near', 4, 300)],
        },
        leaf('t4_far', 4, 5000),
      ],
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
      'qz-ground',
      'qz-city-bridges',
    ])
  })

  it('四条资产的 url 两两不同（指同一个 tileset 就是同一位置渲染两套）', () => {
    const urls = BEIBU_TILES.map((s) => s.url)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('作业区层指向交付包原版、集装箱重建层默认关闭（两者不得指同一个 tileset）', () => {
    expect(QINZHOU.url).toBe('/static/qinzhou-port/tiles/tileset.json')
    const containers = BEIBU_TILES.find((s) => s.id === 'qz-containers')!
    expect(containers.url).toBe('/static/qinzhou-port/rebuilt/tileset.json')
    expect(containers.url).not.toBe(QINZHOU.url)
    // 集装箱重建层不需要再裁：生成时已按作业区半径筛过箱区；且默认关闭（原版已带 cargo）
    expect(containers.derive).toBeUndefined()
    expect(containers.defaultVisible).toBe(false)
  })

  it('url 均为站点根绝对路径（Data URI 挂载前由派生补 origin）', () => {
    for (const s of BEIBU_TILES) expect(s.url.startsWith('/static/')).toBe(true)
  })

  it('只有钦州港核心区声明裁剪；其余五条走整包', () => {
    expect(QINZHOU.derive).toBeDefined()
    const others = BEIBU_TILES.filter((s) => s.id !== 'qinzhou-port')
    expect(others).toHaveLength(5)
    for (const s of others) expect(s.derive).toBeUndefined()
  })

  it('不变量：凡摘内容的条目必须同开「折叠空层 + 压 root GE」（否则远距离整层空白）', () => {
    // 2026-10-04 实测（docs/3dtiles-改造任务表.md §8.15）：dropContent 摘空的层**仍会被选为遍历终点**
    // ⇒ 80 km 与 586 km（页面默认全域视角）整层空白，而同场景三枢纽 6/6 档都在场。
    // 两个开关缺一不可：只删 cap ⇒ 586 km 反而拉全量 458283 tri，与其余资产不同构；
    // 直接压 root 而不折叠 ⇒ 破坏 GE 沿树单调性，遍历停在 root、精细层永不加载。
    //
    // 作用域由清单派生（属性=数组长度），不是手抄名单：新加一条摘内容的资产、漏了这两个开关，此处必红。
    // 这是「LOD 一致性要保证统一性」的可执行形态——运行时阶梯探针（tools/diag/lod-ladder.cjs）
    // 需要 dev server 与 gitignored 交付包，进不了 CI，所以 CI 侧钉这条配置级不变量。
    const droppers = BEIBU_TILES.filter((s) => s.derive?.dropContent)
    // 阳性对照：若将来没人再摘内容，本用例会因下面这行失败而不是静默恒真
    expect(droppers.length).toBeGreaterThan(0)
    const offenders = droppers
      .filter((s) => !s.derive?.collapseEmptyLevels || !s.derive?.capRootGeometricError)
      .map((s) => s.id)
    expect(offenders).toEqual([])
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

describe('shouldDropPortContent — 远景壳例外（root 不摘）', () => {
  it('depth 0 保留内容（远景壳）；depth 1~3 摘；d4/d5 保留', () => {
    expect(shouldDropPortContent({ extras: { depth: 0 } })).toBe(false)
    for (let d = 1; d <= QINZHOU_COARSE_MAX_DEPTH; d++) {
      expect(shouldDropPortContent({ extras: { depth: d } })).toBe(true)
    }
    expect(shouldDropPortContent({ extras: { depth: 4 } })).toBe(false)
    expect(shouldDropPortContent({ extras: { depth: 5 } })).toBe(false)
  })

  it('无 depth 字段按 0 处理 ⇒ 保留（宁多留不误删）', () => {
    expect(shouldDropPortContent({})).toBe(false)
  })
})

describe('prepareBeibuTileset — 清单驱动的分支（行为判据）', () => {
  it('声明 derive 的条目：球外子树消失、球内保留、粗层被摘内容但根壳留住', () => {
    const out = prepareBeibuTileset(makeTileset(), QINZHOU)
    expect(out).not.toBeNull()
    const tiles: string[] = []
    const walk = (n: { extras?: Record<string, unknown>; children?: unknown[] }) => {
      if (n.extras?.tile) tiles.push(String(n.extras.tile))
      for (const c of (n.children ?? []) as (typeof n)[]) walk(c)
    }
    walk(out!.root)
    expect(tiles).toContain('t4_near')
    // 球外 5 km 的瓦片被整棵剔除——删掉裁剪分支这条必红
    expect(tiles).not.toContain('t4_far')
    // root（远景壳）内容保留；空层被折叠后 root 下只剩有内容的精细瓦片。
    // 把 root 的内容也摘掉、或反过来让 d1~d3 保留内容，本用例都必红。
    expect(out!.root.content).toBeDefined()
    expect((out!.root.children ?? []).some((c) => c.extras?.tile === 't4_near')).toBe(true)
    // 且 root 的 GE 必须被压到"被摘空的最深一级"（此处 d2 的 GE=64）以下——
    // 否则遍历会在空层上停下（或反过来在 root 停住、精细层永不加载）⇒ 远景整层空白。
    // 删掉 cap 或 collapse 任一条，本用例必红。
    // 此处空层 d2 的盒半轴 200 ⇒ 归一化尺度 400；不压的话 root 是 18000（整包尺度）
    expect(out!.root.geometricError).toBe(400)
    // uri 绝对化（Data URI 挂载前必需）——挂在保留下来的根壳上看
    expect(out!.root.content!.uri).toContain('/static/')
  })

  it('未声明 derive 的条目：整棵树原样保留（含球外瓦片与 root 内容）', () => {
    const out = prepareBeibuTileset(makeTileset(), WHOLE)
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

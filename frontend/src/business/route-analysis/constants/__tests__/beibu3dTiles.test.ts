// 钦州港 3D Tiles 清单与预处理路径测试。
//
// 钉死三件事：
//   ① **分支落在行为上**：清单声明 derive 的条目走裁剪、没声明的走整包——
//      删掉 prepareBeibuTileset 里的裁剪分支，下面「球外节点消失」的断言必红。
//      （不用源码子串断言：04-F 禁止把源码文本当判据。）
//   ② **粗层只摘内容不删节点**：钦州港 d0~d3 是 d4/d5 的唯一通路，
//      误用 drop（连子树删）会让集装箱/龙门架整棵消失。
//   ③ **裁剪球参数是有据的**：中心/半径来自交付包实测，不是拍的。
//   ④ **LOD 统一切换口径**：四资产（三枢纽 + 港区）的"细化开关 GE ÷ maxSSE"必须同为一个
//      K，否则同一相机距离下有的资产已退粗壳、有的还在拉精细层（2026-10-04 实测 160 km：
//      枢纽粗壳 vs 港区 458283 tri）。三枢纽侧从**受版本控制的真实交付 tileset** 现场派生，
//      港区侧从清单条目 + 夹具派生——改任一侧的 K 而不同步，本组用例必红。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { TilesetJson, TilesetNode } from '@/core/map/tiles3dGroups'

import { LOD_REFINE_GE_PER_SSE } from '../lodRefinePolicy'
import { PINGLU_GROUPS, PINGLU_HUB_MAX_SSE, preparePingluHubTileset } from '../pingluTiles'
import {
  BEIBU_TILES,
  QINZHOU_COARSE_MAX_DEPTH,
  QINZHOU_OPERATION_AREA,
  QINZHOU_SHELL_GUARD_DISTANCE,
  QINZHOU_TOP_GE_FLOOR,
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
    // 注：本不变量只保「遍历终点必有内容」；保留 root 内容做远景壳的条目还要过**整层早退
    // 闸门**（顶层 geometricError），那条由 QINZHOU_TOP_GE_FLOOR 与其 describe 单独钉。
    const droppers = BEIBU_TILES.filter((s) => s.derive?.dropContent)
    // 阳性对照：若将来没人再摘内容，本用例会因下面这行失败而不是静默恒真
    expect(droppers.length).toBeGreaterThan(0)
    // 「压 root GE」有两种可执行形态：capRootGeometricError（按数据上确界）与
    // refineGeometricError（按统一口径 K）。港区改用后者（LOD 距离统一）后本不变量必须
    // 同时接受两种，否则会因"换了机制"误红；只要任一条都没开才判 offender。
    const offenders = droppers
      .filter(
        (s) =>
          !s.derive?.collapseEmptyLevels ||
          (!s.derive?.capRootGeometricError && s.derive?.refineGeometricError === undefined)
      )
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

// 顶层 GE 下限（整层早退闸门）：Cesium 在**访问 root 之前**按顶层 geometricError 判
// 「整层在屏幕上太小」，SSE ≤ maxSSE 即直接 return（visited=0，root 内容也不选）。
// 586 km 默认机位实测：旧顶层值 18045.7 在 900 px 窗（H=605）闸门 SSE 24.0 ≤ 32 ⇒ 整层空白；
// 下限把同一机位抬到 >32，且只动闸门距离、不动 root GE（LOD 切换距离不变）。
describe('QINZHOU_TOP_GE_FLOOR — 港区整层早退闸门的下限', () => {
  // Cesium 口径：gateSSE = geTop·H/(d·sseDenominator)（root 无 parent ⇒ geTop = 顶层值）
  const gateSse = (geTop: number, hPx: number, d: number, denom: number) =>
    (geTop * hPx) / (d * denom)
  // 实测参数（2026-10-04）：默认机位 585,937 m（首屏相机实测）；900 px 探针窗画布 H=605
  // （宽×0.672）；页面 fov 60° / 纵横比 1.488 ⇒ sseDenominator 0.7762（页面实测）
  const D_DEFAULT = 585_937
  const H_900 = 605
  const DENOM_DEFAULT = 0.7762
  // 阳性对照：修复前的顶层值（交付包 root 包围盒世界尺度，页面实测）——必须红
  const GE_TOP_LEGACY = 18_045.70703125

  it('旧值在 900 px 默认机位必触发早退（重现 4/6 红），下限值不触发', () => {
    expect(gateSse(GE_TOP_LEGACY, H_900, D_DEFAULT, DENOM_DEFAULT)).toBeLessThanOrEqual(32)
    expect(gateSse(QINZHOU_TOP_GE_FLOOR, H_900, D_DEFAULT, DENOM_DEFAULT)).toBeGreaterThan(32)
  })

  it('守卫：2× 默认机位、H=600、最坏纵横比（≤1，60° 当竖直）仍不触发早退', () => {
    const denomWorst = 2 * Math.tan(Math.PI / 6)
    expect(
      gateSse(QINZHOU_TOP_GE_FLOOR, 600, QINZHOU_SHELL_GUARD_DISTANCE, denomWorst)
    ).toBeGreaterThan(32)
  })

  it('清单接线：港区条目声明了下限，maxSSE 仍是推导里的那个 32', () => {
    expect(QINZHOU.derive?.topGeometricErrorFloor).toBe(QINZHOU_TOP_GE_FLOOR)
    expect(QINZHOU.maximumScreenSpaceError).toBe(32)
  })

  it('端到端派生：顶层值被抬到下限；root（细化开关）GE 被设为统一口径 K × maxSSE', () => {
    const out = prepareBeibuTileset(makeTileset(), QINZHOU)
    expect(out!.geometricError).toBe(QINZHOU_TOP_GE_FLOOR)
    // root 带内容 + 折叠后仍有子节点 ⇒ 是"细化开关"，GE 由 refineGeometricError 设定。
    // 旧值（capRootGeometricError 的数据上确界，夹具里是 400）已不再是权威——它会让
    // 港区的切换距离比三枢纽远 2.14×（见 LOD_REFINE_GE_PER_SSE 的实测注）。
    expect(out!.root.geometricError).toBe(LOD_REFINE_GE_PER_SSE * QINZHOU.maximumScreenSpaceError)
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
    // 且 root 的 GE 必须是统一口径值（K × maxSSE）——它决定"远距离停在 root 出壳、
    // 近距离细化到精细层"。删掉 collapse 或 refine 任一条，本用例必红（旧 cap 值 400
    // 会让切换距离与三枢纽不一致，见 LOD_REFINE_GE_PER_SSE）。
    expect(out!.root.geometricError).toBe(LOD_REFINE_GE_PER_SSE * QINZHOU.maximumScreenSpaceError)
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

// LOD 统一切换口径：四资产的「细化开关 GE ÷ maxSSE」必须同为一个 K。
//
// 为什么这样钉：切换距离 = GE·H / (maxSSE·sseDenominator·d) 的阈值反解 ⇒ 同视口下
// 只要各资产 K 相同，粗/细切换就发生在同一相机距离——这是用户要的"统一性"的可执行形态。
// 判据的输入：三枢纽侧现场读受版本控制的真实交付 tileset（`backend/static/pinglu/tiles/`）
// 并按 RouteAnalysisPage 的同一条派生链计算；港区侧交付包被 .gitignore 排除（进不了 CI），
// 故用清单条目 + 夹具派生。两侧都从同一个导出常数取 K，任一侧漏接即红。
describe('LOD 统一切换口径 — 四资产同一相机距离切换粗精', () => {
  const K = LOD_REFINE_GE_PER_SSE

  /** 找全部「带内容 + 有子节点」的细化开关节点（与 setRefineSwitchGeometricError 同判据） */
  function refineSwitches(node: TilesetNode, out: TilesetNode[] = []): TilesetNode[] {
    const kids = node.children ?? []
    if (node.content && kids.length > 0) out.push(node)
    for (const k of kids) refineSwitches(k, out)
    return out
  }

  it('清单接线：港区细化 GE = K × 港区 maxSSE（改任一侧必红）', () => {
    expect(K).toBeGreaterThan(0)
    expect(QINZHOU.derive?.refineGeometricError).toBe(K * QINZHOU.maximumScreenSpaceError)
  })

  it('三枢纽（真实交付 tileset 现场派生）：三个细化开关 GE ÷ maxSSE 都等于 K', () => {
    const raw = JSON.parse(
      readFileSync(
        join(__dirname, '../../../../../../backend/static/pinglu/tiles/tileset.json'),
        'utf8'
      )
    ) as TilesetJson
    const ratios: Record<string, number> = {}
    for (const group of PINGLU_GROUPS) {
      // 直调注册点用的同一个函数（派生 + GE 校正 + 统一口径）——函数里漏一步本用例必红
      const prepared = preparePingluHubTileset(raw, group)
      expect(prepared).not.toBeNull()
      const switches = refineSwitches(prepared!.root)
      // 阳性对照：本形态必须恰好有一个细化开关（低模节点）——没有说明派生链变了
      expect(switches).toHaveLength(1)
      expect(switches[0].geometricError).toBe(K * PINGLU_HUB_MAX_SSE)
      ratios[group.id] = switches[0].geometricError! / PINGLU_HUB_MAX_SSE
    }
    // 三个枢纽彼此相同（这一条就是"枢纽之间也不能分叉"）
    expect(Object.values(ratios)).toEqual([K, K, K])
  })

  it('港区（清单条目 + 夹具派生）与三枢纽同 K ⇒ 四资产切换距离相同', () => {
    const port = prepareBeibuTileset(makeTileset(), QINZHOU)
    const switches = refineSwitches(port!.root)
    expect(switches).toHaveLength(1) // 折叠空层后 root 是港区唯一细化开关
    const portRatio = switches[0].geometricError! / QINZHOU.maximumScreenSpaceError
    expect(portRatio).toBe(K)
    // 与枢纽侧同式：K 相同 ⇒ d_switch = K·H / sseDenominator 与资产无关
    expect(portRatio).toBe((K * PINGLU_HUB_MAX_SSE) / PINGLU_HUB_MAX_SSE)
  })
})

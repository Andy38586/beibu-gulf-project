// @vitest-environment node
//
// ⚠️ 环境声明是**语义前提**，不是便利开关。
//
// 本文件断言 `content.uri` 为**站点根相对**（`/static/pinglu/tiles/…`），而
// `resolveUri` 对同一输入有两种合法输出（见 core/tiles3dGroups 的注释）：
//   有 `location`（浏览器/jsdom）→ 补全成 scheme 级绝对地址；
//   无 `location`（node）        → 保持站点根相对。
// 断言写的是后者，故必须跑在 node 环境。
//
// 为什么不在断言里放宽：那样会同时接受两种形态，断言就不再咬住任何一侧 ——
// 而 core 侧 tiles3dGroups.test.ts 恰好断言的是**前者**（跑 jsdom）。
// 两边各钉一种语义，「谁把另一种写进代码」时都有一侧会红。
// 缺此行时的实况：2026-09-26 `d2a86e2c` 引入 location 分支后本文件即转红，
// 因为默认 jsdom 下 uri 被补成 `http://localhost:3000/static/...`。
//
// 平陆运河 3D Tiles 分组**业务配置**测试。
//
// 通用派生机制（裁子树 / uri 绝对化 / Data URI / 归属统计）在 core 侧已用中性用例钉死，
// 见 core/map/__tests__/tiles3dGroups.test.ts。这里只断言**平陆运河特有的语义**：
// 分组数量与命名、判定依据（extras 而非文件名）、以及最重要的一条 ——
// **31 个内容节点恰好归属 5 个分组，不漏不重**。
//
// 「不漏」为什么重要：漏掉的瓦片在界面上没有任何开关能显示它，用户只会看到
// 地图上少一块楼，且没有任何报错。这条断言是那份事故（17 节点版被当成完整版）
// 的直接对照。
import { describe, expect, it } from 'vitest'

import { deriveGroupTileset, tallyGroups, type TilesetJson } from '@/core'

import { LOD_REFINE_GE_PER_SSE } from '../lodRefinePolicy'
import {
  PINGLU_GROUPS,
  PINGLU_HUB_MAX_SSE,
  PINGLU_TILESET_URL,
  pingluLayerId,
  preparePingluHubTileset,
} from '../pingluTiles'

/**
 * 还原交付版 tileset.json 的 root 直属结构（数值取自真实文件，非估计）。
 *
 * 实测：共 31 个内容节点、root 直属 17 个 child，分发为
 *   · 3 个枢纽（马道 6 / 企石 6 / 青年 5 个内容节点，含低模自身与分区子瓦片）
 *   · 3 个 bridges-*（各 1）
 *   · 11 个 corridor-*（各 1）
 * 合计 6+6+5+3+11 = 31 ✓
 *
 * 本文件只断言 root 直属层的分组归属与子树保留，故建模到"17 child + 正确的子树深度"
 * 这一层即可；每个枢纽的子树数量也按实测填（6/6/5），使落位与保留断言有意义。
 */
function makeDeliveryTileset(): TilesetJson {
  // 每个枢纽的内容节点数（含低模自身）：马道 6 / 企石 6 / 青年 5 —— 取自实测
  const HUB_PARTS: Record<string, string[]> = {
    马道枢纽: ['z1-terrain', 'z2-upstream', 'z3-lock', 'z4-pool', 'z6-downstream'],
    企石枢纽: ['z1-terrain', 'z2-upstream', 'z3-lock', 'z4-pool', 'z6-downstream'],
    青年枢纽: ['z1-terrain', 'z2-upstream', 'z3-lock', 'z6-downstream'],
  }
  // 零件中文名（与交付包 extras.name 同口径；drop 谓词按名字匹配，缺名字会让断言成假红壳）
  const PART_LABEL: Record<string, string> = {
    'z1-terrain': '地形与边坡',
    'z2-upstream': '上游引航道',
    'z3-lock': '船闸主体',
    'z4-pool': '省水池与泄水建筑物',
    'z6-downstream': '下游引航道',
  }
  const hub = (name: string, uri: string) => ({
    content: { uri },
    extras: { name, order: 1 },
    geometricError: 40,
    children: HUB_PARTS[name].map((part) => ({
      content: { uri: uri.replace('.glb', `-${part}.glb`) },
      extras: { name: `${name} · ${PART_LABEL[part]}` },
      geometricError: 20,
    })),
  })
  const corridor = (uri: string) => ({
    content: { uri },
    extras: { name: `全线走廊 · ${uri.replace('.glb', '')}`, kind: 'corridor' },
    geometricError: 60,
  })
  return {
    asset: { version: '1.1', generator: 'PingluCanal Tiles Builder + WGS84 baked curvature' },
    geometricError: 4000,
    root: {
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1906923.35, 5591951.31, 2394932.09, 1],
      boundingVolume: { box: [0, 0, 0, 40000, 0, 0, 0, 20000, 0, 0, 0, 800] },
      geometricError: 1200,
      refine: 'REPLACE',
      extras: { name: '平陆运河 · 三大梯级枢纽' },
      children: [
        hub('马道枢纽', 'madao-low.glb'),
        hub('企石枢纽', 'qishi-low.glb'),
        hub('青年枢纽', 'qingnian-low.glb'),
        corridor('bridges-mid.glb'),
        corridor('bridges-up.glb'),
        corridor('bridges-urban.glb'),
        ...Array.from({ length: 11 }, (_, i) =>
          corridor(`corridor-${String(i).padStart(2, '0')}.glb`)
        ),
      ],
    },
  }
}

const BASE = '/static/pinglu/tiles/tileset.json'

describe('PINGLU_GROUPS — 分组表自身的完整性', () => {
  it('权威源必须是 tiles/ 而不是 tiles-v2（用户裁定「以最后那一套为准」）', () => {
    // 两套的判据与失效条件见 pingluTiles 里 tiles-v2 的废弃成文段。
    // 判据写「不得含 tiles-v2」而不是「必须等于某串」：后者会在换交付包时误红，
    // 而本条要钉的是「别读回旧套」这一件事。
    expect(PINGLU_TILESET_URL).not.toContain('tiles-v2')
    expect(PINGLU_TILESET_URL).toBe('/static/pinglu/tiles/tileset.json')
  })

  it('3 个分组（只剩三枢纽），id 唯一', () => {
    expect(PINGLU_GROUPS).toHaveLength(3)
    expect(new Set(PINGLU_GROUPS.map((g) => g.id)).size).toBe(3)
    expect(PINGLU_GROUPS.map((g) => g.id)).toEqual(['madao', 'qishi', 'qingnian'])
  })

  it('bridges 与 corridor 分组均已作废：不得出现在表里（否则与新层双重渲染）', () => {
    const ids = PINGLU_GROUPS.map((g) => g.id as string)
    expect(ids).not.toContain('bridges')
    expect(ids).not.toContain('corridor')
  })

  it('bridges 分组已作废：不得出现在表里（否则与城区五桥层双重渲染）', () => {
    // 判据是「表里没有」而不是「顺序对」——废弃的是分组本身，不是它的优先级。
    // 作废判据与失效条件见 pingluTiles 里 bridges 分组下方的成文段。
    // 强转 string 比较：'bridges' 已不在 PingluGroupId 联合里，直接比会报"无重叠"
    expect(PINGLU_GROUPS.some((g) => (g.id as string) === 'bridges')).toBe(false)
  })

  it('图层 id 由前缀 + 分组 id 拼成', () => {
    expect(pingluLayerId('madao')).toBe('pinglu-madao')
    expect(pingluLayerId('qingnian')).toBe('pinglu-qingnian')
  })
})

describe('tallyGroups — 真实交付版不漏不重', () => {
  it('17 个直属 child：3 个枢纽归属，14 个（11 走廊 + 3 桥梁）按废弃判定进未归属', () => {
    const { counts, unassigned } = tallyGroups(makeDeliveryTileset(), PINGLU_GROUPS)
    expect(counts.madao).toBe(1)
    expect(counts.qishi).toBe(1)
    expect(counts.qingnian).toBe(1)
    // corridor 与 bridges 分组均已作废（判据见 pingluTiles 的成文段）：14 块必须
    // 落在未归属里，这是**预期行为**不是漏块——未归属 = 派生时丢弃 =
    // 不与自建运河层 / 城区五桥层双重渲染
    expect(unassigned).toHaveLength(14)
    expect(unassigned.filter((u) => u.startsWith('corridor-'))).toHaveLength(11)
    expect(unassigned.filter((u) => u.startsWith('bridges-'))).toHaveLength(3)
    // 归属合计必须等于 17 − 未归属数——漏一个就会出现"开关开了没东西"
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    expect(total).toBe(17 - unassigned.length)
    expect(total).toBe(3)
  })

  it('新增瓦片若不属于任何分组 → 进未归属清单（防止重烘后静默漏块）', () => {
    const ts = makeDeliveryTileset()
    ts.root.children!.push({ content: { uri: 'brand-new-thing.glb' }, extras: { name: '新东西' } })
    const { unassigned } = tallyGroups(ts, PINGLU_GROUPS)
    // 14 个已作废的（11 走廊 + 3 桥梁）+ 1 个新增
    expect(unassigned).toContain('brand-new-thing.glb')
    expect(unassigned).toHaveLength(15)
  })
})

describe('判定语义 — 为什么按 extras 而非文件名', () => {
  it('枢纽按 extras.name 判定：文件名改了也仍归组', () => {
    const ts = makeDeliveryTileset()
    // 把文件名换掉，extras 不动 —— 仍应被马道组命中
    ts.root.children![0].content = { uri: 'renamed-hub.glb' }
    const { counts, unassigned } = tallyGroups(ts, PINGLU_GROUPS)
    expect(counts.madao).toBe(1)
    // 走廊块已全部作废 ⇒ 一律进未归属，不再有任何分组认领它们
    expect(unassigned.filter((u) => u.startsWith('corridor-'))).toHaveLength(11)
  })

  it('已作废的 corridor-* / bridges-* 不被任何分组认领（不得被捎带渲染）', () => {
    const { unassigned } = tallyGroups(makeDeliveryTileset(), PINGLU_GROUPS)
    const cUris = unassigned
    expect(cUris.some((u) => u.includes('bridges-'))).toBe(true)
    expect(cUris.some((u) => u.includes('corridor-'))).toBe(true)
  })
})

describe('派生结果落位一致', () => {
  it('4 个分组派生后 transform 全部与整包逐位相同', () => {
    const src = makeDeliveryTileset()
    for (const g of PINGLU_GROUPS) {
      const d = deriveGroupTileset(src, g, BASE)
      expect(d).not.toBeNull()
      expect(d!.root.transform).toEqual(src.root.transform)
      expect(d!.root.boundingVolume).toEqual(src.root.boundingVolume)
    }
  })

  it('枢纽子瓦片随父节点一并保留，uri 已绝对化', () => {
    const madao = deriveGroupTileset(makeDeliveryTileset(), PINGLU_GROUPS[0], BASE)!
    expect(madao.root.children![0].children).toHaveLength(5)
    const parts = madao.root.children![0].children!.map((c) => c.content!.uri as string)
    expect(parts.every((u) => u.startsWith('/static/pinglu/tiles/'))).toBe(true)
    expect(parts.some((u) => u.includes('-z3-lock.glb'))).toBe(true)
  })
})

// 注册点直调的派生函数：派生 + GE 校正 + 统一 LOD 切换口径。
// 判据落在行为上（04-F）：链里删掉"统一口径"这一步，下面的断言必红。
describe('preparePingluHubTileset — 统一 LOD 切换口径在链内', () => {
  it('细化开关（低模枢纽节点）GE = K × PINGLU_HUB_MAX_SSE；分区叶子不动', () => {
    const prepared = preparePingluHubTileset(makeDeliveryTileset(), PINGLU_GROUPS[0], BASE)!
    expect(prepared).not.toBeNull()
    const hubNode = prepared.root.children![0]
    expect(hubNode.geometricError).toBe(LOD_REFINE_GE_PER_SSE * PINGLU_HUB_MAX_SSE)
    // 分区子瓦片是叶子（最精细层）：改了只会要求"继续细化"，必须保持原值
    for (const part of hubNode.children!) expect(part.geometricError).toBe(20)
    // 阴性对照：不带统一口径的裸派生仍是交付包原值 40——两值不同才说明这一步真的落地了
    const bare = deriveGroupTileset(makeDeliveryTileset(), PINGLU_GROUPS[0], BASE)!
    expect(bare.root.children![0].geometricError).toBe(40)
  })

  it('三个枢纽都过同一口径（改单侧 K/maxSSE 必红）', () => {
    const src = makeDeliveryTileset()
    for (const g of PINGLU_GROUPS) {
      const prepared = preparePingluHubTileset(src, g, BASE)!
      expect(prepared.root.children![0].geometricError).toBe(
        LOD_REFINE_GE_PER_SSE * PINGLU_HUB_MAX_SSE
      )
    }
  })

  it('2026-10-05 裁定：枢纽自带「地形与边坡」(z1) 放行——不得再被派生剔除', () => {
    // 用户实测：剔除后枢纽周边高边坡多级台阶整圈消失。恢复 drop 谓词 ⇒ 本条必红。
    const prepared = preparePingluHubTileset(makeDeliveryTileset(), PINGLU_GROUPS[0], BASE)!
    const uris = prepared.root.children![0].children!.map((c) => c.content!.uri as string)
    expect(uris.some((u) => u.includes('-z1-terrain.glb'))).toBe(true)
    expect(uris).toHaveLength(5) // z1/z2/z3/z4/z6 一件不少
  })
})

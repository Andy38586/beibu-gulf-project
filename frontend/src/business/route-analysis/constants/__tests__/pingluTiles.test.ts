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

import { PINGLU_GROUPS, pingluLayerId } from '../pingluTiles'

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
  const hub = (name: string, uri: string) => ({
    content: { uri },
    extras: { name, order: 1 },
    geometricError: 40,
    children: HUB_PARTS[name].map((part) => ({
      content: { uri: uri.replace('.glb', `-${part}.glb`) },
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
  it('5 个分组，id 唯一', () => {
    expect(PINGLU_GROUPS).toHaveLength(5)
    expect(new Set(PINGLU_GROUPS.map((g) => g.id)).size).toBe(5)
  })

  it('bridges 必须排在 corridor 之前（顺序即优先级，否则桥会被走廊抢先命中而漏掉桥梁组）', () => {
    const ids = PINGLU_GROUPS.map((g) => g.id)
    expect(ids.indexOf('bridges')).toBeLessThan(ids.indexOf('corridor'))
  })

  it('图层 id 由前缀 + 分组 id 拼成', () => {
    expect(pingluLayerId('madao')).toBe('pinglu-madao')
    expect(pingluLayerId('corridor')).toBe('pinglu-corridor')
  })
})

describe('tallyGroups — 真实交付版不漏不重', () => {
  it('17 个直属 child 全部归属，无遗漏', () => {
    const { counts, unassigned } = tallyGroups(makeDeliveryTileset(), PINGLU_GROUPS)
    expect(unassigned).toEqual([])
    expect(counts.madao).toBe(1)
    expect(counts.qishi).toBe(1)
    expect(counts.qingnian).toBe(1)
    expect(counts.bridges).toBe(3)
    expect(counts.corridor).toBe(11)
    // 合计必须等于 root.children 长度——漏一个就会出现"开关开了没东西"
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    expect(total).toBe(17)
  })

  it('新增瓦片若不属于任何分组 → 进未归属清单（防止重烘后静默漏块）', () => {
    const ts = makeDeliveryTileset()
    ts.root.children!.push({ content: { uri: 'brand-new-thing.glb' }, extras: { name: '新东西' } })
    const { unassigned } = tallyGroups(ts, PINGLU_GROUPS)
    expect(unassigned).toEqual(['brand-new-thing.glb'])
  })
})

describe('判定语义 — 为什么按 extras 而非文件名', () => {
  it('枢纽按 extras.name 判定：文件名改了也仍归组', () => {
    const ts = makeDeliveryTileset()
    // 把文件名换掉，extras 不动 —— 仍应被马道组命中
    ts.root.children![0].content = { uri: 'renamed-hub.glb' }
    const { counts } = tallyGroups(ts, PINGLU_GROUPS)
    expect(counts.madao).toBe(1)
    expect(counts.corridor).toBe(11)
  })

  it('bridges 与 corridor 同为 kind:corridor，靠 uri 前缀区分且互斥', () => {
    const bridges = deriveGroupTileset(
      makeDeliveryTileset(),
      PINGLU_GROUPS.find((g) => g.id === 'bridges')!,
      BASE
    )!
    const corridor = deriveGroupTileset(
      makeDeliveryTileset(),
      PINGLU_GROUPS.find((g) => g.id === 'corridor')!,
      BASE
    )!
    expect(bridges.root.children).toHaveLength(3)
    expect(corridor.root.children).toHaveLength(11)
    const bUris = bridges.root.children!.map((c) => c.content!.uri as string)
    const cUris = corridor.root.children!.map((c) => c.content!.uri as string)
    expect(bUris.every((u) => u.includes('bridges-'))).toBe(true)
    expect(cUris.some((u) => u.includes('bridges-'))).toBe(false)
    // 两组交集为空 —— 桥不会被渲染两遍
    expect(bUris.filter((u) => cUris.includes(u))).toEqual([])
  })
})

describe('派生结果落位一致', () => {
  it('5 个分组派生后 transform 全部与整包逐位相同', () => {
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

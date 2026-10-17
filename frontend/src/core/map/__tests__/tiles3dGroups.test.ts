// 3D Tiles 分组派生（**通用能力**）测试。
//
// 本模块不含业务语义，故测试也不用任何平陆运河 / 枢纽 / 桥梁字面量——分组谓词
// 全部在用例内就地构造。业务分组表的断言在
// business/route-analysis/constants/__tests__/pingluTiles.test.ts。
//
// 三个语义必须在测试里钉死：
//   ① **落位不变量**：派生瓦片的 root.transform / boundingVolume 必须与整包**逐位相同**，
//      否则分组切换时模型会跳位（这比"少显示几个瓦片"严重得多）；
//   ② **不漏不重**：各分组命中数之和 + 未归属数 == root.children.length；
//      漏了表现为"开了开关也不显示"，重了表现为"同一内容被渲染两遍"；
//   ③ **uri 绝对化**：派生 JSON 以 Data URI 交给 Cesium，其 basePath 为空，
//      相对 uri 必然 404，故必须重写成绝对地址。
import { describe, expect, it } from 'vitest'

import {
  cropTilesetForDataUri,
  deriveGroupTileset,
  normalizeTilesetGeometricError,
  nodeName,
  prepareTilesetForDataUri,
  tallyGroups,
  toDataUri,
  type CropSphere,
  type GroupSpec,
  type TilesetJson,
  type TilesetNode,
} from '../tiles3dGroups'

/** 造一棵结构上真实（root 纯容器 + 两级子树）但语义中性的瓦片集 */
function makeTileset(): TilesetJson {
  const node = (uri: string, name: string, children: TilesetNode[] = []): TilesetNode => ({
    content: { uri },
    extras: { name },
    geometricError: 40,
    children,
  })
  return {
    asset: { version: '1.1', generator: 'test + WGS84 baked curvature' },
    geometricError: 4000,
    root: {
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1906923.35, 5591951.31, 2394932.09, 1],
      boundingVolume: { box: [0, 0, 0, 40000, 0, 0, 0, 20000, 0, 0, 0, 800] },
      geometricError: 1200,
      refine: 'REPLACE',
      extras: { name: 'root', anchor: { lon: 108.83, lat: 22.2 } },
      children: [
        node('alpha.glb', 'A', [node('alpha-part.glb', 'A-part')]),
        node('beta.glb', 'B', [node('beta-part.glb', 'B-part')]),
        node('gamma.glb', 'C'),
      ],
    },
  }
}

const BASE = '/static/x/tiles/tileset.json'

/** 两个互斥分组：按 extras.name 首字母归 A 组 / 其余归 B 组 */
const GROUP_A: GroupSpec<'a'> = { id: 'a', label: 'A 组', match: (c) => nodeName(c) === 'A' }
const GROUP_B: GroupSpec<'b'> = {
  id: 'b',
  label: 'B 组',
  match: (c) => nodeName(c) !== 'A',
}
const GROUPS = [GROUP_A, GROUP_B] as const

describe('节点读取helper', () => {
  it('nodeName 只认字符串型 extras.name', () => {
    expect(nodeName({ extras: { name: 'X' } })).toBe('X')
    expect(nodeName({ extras: { name: 42 } })).toBe('')
    expect(nodeName({})).toBe('')
  })
})

describe('tallyGroups — 分组不漏不重', () => {
  it('全部 child 归属，无遗漏', () => {
    const { counts, unassigned } = tallyGroups(makeTileset(), GROUPS)
    expect(unassigned).toEqual([])
    expect(counts.a).toBe(1)
    expect(counts.b).toBe(2)
    // 合计必须等于 root.children 长度——漏一个就会出现"开关开了没东西"
    const total = Object.values(counts).reduce((x, y) => x + y, 0)
    expect(total).toBe(3)
  })

  it('未知节点进未归属清单（防止新增瓦片被静默分漏）', () => {
    const ts = makeTileset()
    const lone: GroupSpec<'none'> = { id: 'none', label: '无', match: () => false }
    const { unassigned } = tallyGroups(ts, [lone])
    expect(unassigned).toHaveLength(3)
  })

  it('一个 child 命中多组时只计入首个（顺序即优先级，避免重复计数）', () => {
    const both: GroupSpec<'first' | 'second'>[] = [
      { id: 'first', label: '先', match: () => true },
      { id: 'second', label: '后', match: () => true },
    ]
    const { counts } = tallyGroups(makeTileset(), both)
    expect(counts.first).toBe(3)
    expect(counts.second).toBe(0)
  })
})

describe('deriveGroupTileset — 落位不变量（最重要）', () => {
  it('派生瓦片与整包的 root.transform / boundingVolume / geometricError 逐位相同', () => {
    const src = makeTileset()
    for (const g of GROUPS) {
      const d = deriveGroupTileset(src, g, BASE)
      expect(d).not.toBeNull()
      expect(d!.root.transform).toEqual(src.root.transform)
      expect(d!.root.boundingVolume).toEqual(src.root.boundingVolume)
      expect(d!.root.geometricError).toBe(src.root.geometricError)
      expect(d!.root.refine).toBe(src.root.refine)
      expect(d!.root.extras).toEqual(src.root.extras)
      // asset 也须原样（generator 里的 baked curvature 标记是排障依据）
      expect(d!.asset).toEqual(src.asset)
    }
  })

  it('只保留命中分组的子树，其余分组的内容不出现', () => {
    const madao = deriveGroupTileset(makeTileset(), GROUP_A, BASE)!
    expect(madao.root.children).toHaveLength(1)
    expect(madao.root.children![0].content!.uri).toContain('alpha.glb')
    // 子树（分区瓦片）保留
    expect(madao.root.children![0].children).toHaveLength(1)
    // 其它分组不出现
    const uris = JSON.stringify(madao)
    expect(uris).not.toContain('beta')
    expect(uris).not.toContain('gamma')
  })

  it('分组无命中 → 返回 null（不给 Cesium 造一个永远空的瓦片集）', () => {
    const empty: TilesetJson = {
      asset: { version: '1.1' },
      geometricError: 1,
      root: { children: [] },
    }
    const none: GroupSpec<'n'> = { id: 'n', label: 'x', match: (c) => c.extras?.name === '无' }
    expect(deriveGroupTileset(empty, none, BASE)).toBeNull()
    // root 缺 children 也不崩
    expect(
      deriveGroupTileset({ asset: { version: '1.1' }, geometricError: 1, root: {} }, GROUP_A, BASE)
    ).toBeNull()
  })
})

describe('deriveGroupTileset — drop 剪枝（剔除选中分组内的指定内容）', () => {
  it('命中深层子节点 → 只剪那一个（match 只看 root 层，drop 必须递归到底）', () => {
    const d = deriveGroupTileset(makeTileset(), GROUP_A, BASE, {
      drop: (n) => nodeName(n) === 'A-part',
    })!
    expect(d).not.toBeNull()
    // 父节点 alpha 保留
    expect(d.root.children).toHaveLength(1)
    expect(d.root.children![0].content!.uri).toContain('alpha.glb')
    // 子节点 A-part 被剪 ⇒ children 为空数组（不是残留 null）
    expect(d.root.children![0].children).toEqual([])
    expect(JSON.stringify(d)).not.toContain('alpha-part')
  })

  it('命中 root 直属 child → 该分组整体无内容 ⇒ 返回 null，而不是空壳瓦片集', () => {
    expect(
      deriveGroupTileset(makeTileset(), GROUP_A, BASE, { drop: (n) => nodeName(n) === 'A' })
    ).toBeNull()
  })

  it('命中 root 自身 → 返回 null', () => {
    expect(deriveGroupTileset(makeTileset(), GROUP_A, BASE, { drop: () => true })).toBeNull()
  })

  it('drop 不命中任何节点 ⇒ 与不传 drop 的结果逐位相同（等价重构不许红）', () => {
    const withDrop = deriveGroupTileset(makeTileset(), GROUP_A, BASE, { drop: () => false })
    const without = deriveGroupTileset(makeTileset(), GROUP_A, BASE)
    expect(withDrop).toEqual(without)
  })

  it('drop 只在被选中的子树内求值：未选中的分组内容不会被连带处理', () => {
    const seen: string[] = []
    deriveGroupTileset(makeTileset(), GROUP_A, BASE, {
      drop: (n) => {
        seen.push(String(nodeName(n) ?? '(root)'))
        return false
      },
    })
    // A 组只含 alpha 子树 ⇒ drop 只该看到 root / A / A-part
    expect(seen).toContain('A')
    expect(seen).not.toContain('B')
    expect(seen).not.toContain('C')
  })

  it('纯函数：drop 剪枝不改动原始 tileset', () => {
    const src = makeTileset()
    const before = JSON.stringify(src)
    deriveGroupTileset(src, GROUP_A, BASE, { drop: (n) => nodeName(n) === 'A-part' })
    expect(JSON.stringify(src)).toBe(before)
  })
})

describe('uri 绝对化 — 经派生/裁剪公开面', () => {
  // jsdom 环境有 location：站点根相对必须补全到 scheme 级绝对地址——
  // data: 基准下 Cesium 把根相对 uri 拼成 data:///… 畸形地址（2026-09-26 实测零渲染缺陷）
  it('站点相对基准 → 拼出 scheme 级绝对地址', () => {
    const out = deriveGroupTileset(makeTileset(), GROUP_A, '/static/x/tiles/tileset.json')!
    const a = out.root.children![0]
    expect(a.content!.uri!.startsWith('http')).toBe(true)
    expect(new URL(a.content!.uri!).pathname).toBe('/static/x/tiles/alpha.glb')
    expect(new URL(a.children![0].content!.uri!).pathname).toBe('/static/x/tiles/alpha-part.glb')
  })

  it('带协议前缀的基准 → 保留协议与主机', () => {
    const out = deriveGroupTileset(makeTileset(), GROUP_A, 'https://x.test/a/b/tileset.json')!
    expect(out.root.children![0].content!.uri).toBe('https://x.test/a/b/alpha.glb')
  })

  it('已是绝对地址（http/data/blob）→ 原样返回', () => {
    const src = makeTileset()
    const abs = ['http://a/b.glb', 'https://a/b.glb', 'data:application/octet-stream;base64,AA']
    abs.forEach((u, i) => {
      src.root.children![i].content!.uri = u
    })
    const out = cropTilesetForDataUri(src, '/static/tileset.json')!
    expect(out.root.children![0].content!.uri).toBe('http://a/b.glb')
    expect(out.root.children![1].content!.uri).toBe('https://a/b.glb')
    expect(out.root.children![2].content!.uri).toBe('data:application/octet-stream;base64,AA')
  })

  it('uri 以斜杠开头按站点根处理（补 origin 成 scheme 级绝对，不拼基准目录）', () => {
    const src = makeTileset()
    src.root.children![0].content!.uri = '/static/y.glb'
    const out = deriveGroupTileset(src, GROUP_A, '/static/x/tiles/tileset.json')!
    const u = out.root.children![0].content!.uri!
    expect(new URL(u).pathname).toBe('/static/y.glb')
    expect(u.startsWith('http')).toBe(true)
  })
})

describe('派生结果整体自洽', () => {
  it('所有分组派生后，content.uri 全部为绝对地址（无残留相对路径）', () => {
    const src = makeTileset()
    for (const g of GROUPS) {
      const d = deriveGroupTileset(src, g, BASE)!
      const collect = (n: { content?: { uri?: string }; children?: unknown[] }): string[] => [
        ...(n.content?.uri ? [n.content.uri] : []),
        ...((n.children ?? []) as { content?: { uri?: string }; children?: unknown[] }[]).flatMap(
          collect
        ),
      ]
      for (const u of collect(d.root)) {
        // scheme 级绝对地址（jsdom 下为 http://localhost/…）：路径段落在基准目录内
        expect(new URL(u).pathname.startsWith('/static/x/tiles/')).toBe(true)
      }
    }
  })

  it('原始 tileset 不被修改（派生是纯函数，无副作用）', () => {
    const src = makeTileset()
    const snapshot = JSON.stringify(src)
    for (const g of GROUPS) deriveGroupTileset(src, g, BASE)
    expect(JSON.stringify(src)).toBe(snapshot)
  })

  it('旧版 content.url 字段被清理，只留绝对化的 uri', () => {
    const src: TilesetJson = {
      asset: { version: '1.0' },
      geometricError: 1,
      root: {
        children: [{ content: { url: 'legacy.glb' }, extras: { name: 'A' } }],
      },
    }
    const d = deriveGroupTileset(src, GROUP_A, BASE)!
    const content = d.root.children![0].content as { uri?: string; url?: string }
    // scheme 级绝对地址（jsdom origin + 基准目录），旧 url 字段必须已被清掉
    expect(new URL(content.uri!).pathname).toBe('/static/x/tiles/legacy.glb')
    expect(content.url).toBeUndefined()
  })

  it('toDataUri 能承载非 ASCII extras（UTF-8 逐字节编码，不因 btoa 抛错）', () => {
    // extras.name 必须同时满足分组谓词（GROUP_A 认 'A'）与含中文，
    // 故谓词改用「含中文字符」这一中性条件，避免用例里出现业务字样
    const chinese: GroupSpec<'cn'> = {
      id: 'cn',
      label: '中文',
      match: (c) => nodeName(c).includes('名'),
    }
    const src: TilesetJson = {
      asset: { version: '1.1' },
      geometricError: 1,
      root: {
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1],
        children: [{ content: { uri: 'a.glb' }, extras: { name: '中文名字' } }],
      },
    }
    const d = deriveGroupTileset(src, chinese, BASE)!
    const uri = toDataUri(d)
    expect(uri.startsWith('data:application/json;base64,')).toBe(true)
    // 解回来验证中文没丢
    const b64 = uri.split(',')[1]
    const bin = atob(b64)
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain('中文名字')
    expect(JSON.parse(text).root.transform).toEqual(src.root.transform)
  })
})

/** 构造一棵 GE 相对包围尺度偏小的瓦片集（root→inner→leaf，含一个直属 leaf） */
function makeGeTileset(): TilesetJson {
  return {
    asset: { version: '1.1' },
    geometricError: 300,
    root: {
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1],
      // 最大半轴 5000 ⇒ 世界尺度 10000
      boundingVolume: { box: [0, 0, 0, 5000, 0, 0, 0, 3000, 0, 0, 0, 200] },
      geometricError: 256,
      refine: 'REPLACE',
      children: [
        {
          // 最大半轴 1000 ⇒ 世界尺度 2000
          boundingVolume: { box: [0, 0, 0, 1000, 0, 0, 0, 800, 0, 0, 0, 50] },
          geometricError: 64,
          refine: 'REPLACE',
          content: { uri: 'inner.glb' },
          children: [{ content: { uri: 'leaf.glb' }, geometricError: 0, refine: 'ADD' }],
        },
        // 直属叶子（无 children）
        { content: { uri: 'leaf2.glb' }, geometricError: 0, refine: 'ADD' },
      ],
    },
  }
}

describe('normalizeTilesetGeometricError — GE 锚定包围尺度', () => {
  it('内部节点 GE 抬到包围体世界尺度，顶层 GE 同步', () => {
    const out = normalizeTilesetGeometricError(makeGeTileset())
    // root 尺度 10000 ⇒ GE 由 256 抬到 10000；顶层 300 也抬到 10000
    expect(out.geometricError).toBe(10000)
    expect(out.root.geometricError).toBe(10000)
    // inner 尺度 2000 ⇒ GE 由 64 抬到 2000
    expect(out.root.children![0].geometricError).toBe(2000)
  })

  it('叶子节点（无 children）GE 保持原值（最精细层不抬）', () => {
    const out = normalizeTilesetGeometricError(makeGeTileset())
    expect(out.root.children![0].children![0].geometricError).toBe(0)
    expect(out.root.children![1].geometricError).toBe(0)
  })

  it('包围体用 sphere 记法同样校正（同义记法不允许漏检）', () => {
    const src: TilesetJson = {
      asset: { version: '1.1' },
      geometricError: 1,
      root: {
        boundingVolume: { sphere: [0, 0, 0, 7000] }, // 直径 14000
        geometricError: 256,
        children: [{ content: { uri: 'a.glb' }, geometricError: 0 }],
      },
    }
    const out = normalizeTilesetGeometricError(src)
    expect(out.root.geometricError).toBe(14000)
    expect(out.geometricError).toBe(14000)
  })

  it('GE 已不小于包围尺度时不被降低（max 语义，不破坏本就正确的瓦片）', () => {
    const src = makeGeTileset()
    src.root.geometricError = 99999
    expect(normalizeTilesetGeometricError(src).root.geometricError).toBe(99999)
  })

  it('内部节点缺包围体 ⇒ 尺度算 0、GE 保持（不臆造尺度）', () => {
    const src: TilesetJson = {
      asset: { version: '1.1' },
      geometricError: 1,
      root: {
        geometricError: 256,
        children: [
          {
            geometricError: 64,
            children: [{ content: { uri: 'a.glb' }, geometricError: 0 }],
          },
        ],
      },
    }
    const out = normalizeTilesetGeometricError(src)
    expect(out.root.geometricError).toBe(256)
    expect(out.root.children![0].geometricError).toBe(64)
  })

  it('落位不变：transform / boundingVolume / content 不被改动', () => {
    const src = makeGeTileset()
    const out = normalizeTilesetGeometricError(src)
    expect(out.root.transform).toEqual(src.root.transform)
    expect(out.root.boundingVolume).toEqual(src.root.boundingVolume)
    expect(out.root.children![0].content).toEqual({ uri: 'inner.glb' })
  })

  it('纯函数：不改入参', () => {
    const src = makeGeTileset()
    const before = JSON.stringify(src)
    normalizeTilesetGeometricError(src)
    expect(JSON.stringify(src)).toBe(before)
  })
})

describe('prepareTilesetForDataUri — 整包 uri 绝对化 + GE 校正', () => {
  it('保留整棵树（不裁剪），uri 全部绝对化且 GE 抬升', () => {
    const src = makeGeTileset()
    const out = prepareTilesetForDataUri(src, 'http://x.test/static/x/tileset.json')
    // 两个 children 都在（不裁剪）
    expect(out.root.children).toHaveLength(2)
    const inner = out.root.children![0]
    expect(inner.content!.uri).toBe('http://x.test/static/x/inner.glb')
    expect(inner.children![0].content!.uri).toBe('http://x.test/static/x/leaf.glb')
    expect(out.root.children![1].content!.uri).toBe('http://x.test/static/x/leaf2.glb')
    // GE 同时被校正
    expect(out.root.geometricError).toBe(10000)
    expect(inner.geometricError).toBe(2000)
  })

  it('纯函数：不改入参', () => {
    const src = makeGeTileset()
    const before = JSON.stringify(src)
    prepareTilesetForDataUri(src, 'http://x.test/static/x/tileset.json')
    expect(JSON.stringify(src)).toBe(before)
  })
})

// ---- 空间裁剪（cropTileset / boundingIntersectsSphere / dropContent） ----
//
// 语义中性的四层树：root（含 content）→ a（含 content）→ b（含 content）→ c（叶子）。
// 每层包围盒逐级内缩且同心，这样「保留/剔除」只由球决定，与盒形状无关。
function makeDeepTileset(): TilesetJson {
  const node = (uri: string, half: number, children: TilesetNode[] = []): TilesetNode => ({
    content: { uri },
    extras: { name: uri.replace('.glb', '') },
    geometricError: 0,
    boundingVolume: { box: [0, 0, 0, half, 0, 0, 0, half, 0, 0, 0, 10] },
    children,
  })
  return {
    asset: { version: '1.1', generator: 'test' },
    geometricError: 4000,
    root: {
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      boundingVolume: { box: [0, 0, 0, 4000, 0, 0, 0, 4000, 0, 0, 0, 10] },
      geometricError: 1200,
      refine: 'REPLACE',
      content: { uri: 'root.glb' },
      extras: { name: 'root' },
      children: [node('a.glb', 2000, [node('b.glb', 1000, [node('c.glb', 200)])])],
    },
  }
}

describe('包围体与球的相交判定 — 经 cropTilesetForDataUri({ keepSphere }) 公开面', () => {
  const box = [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]
  // 对照 child：盒心远在 1e6，任何用例的球都够不着 ⇒ 它必须每次都被剔除，
  // 用来证明「保留/剔除」确实由包围体判定驱动，而不是「谁都没被裁」的假绿。
  const FAR = [1e6, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]

  /** root 自带内容（保证结果非 null）+ case/far 两个 child，只有 case 的包围体随用例变化 */
  const makeBvTileset = (bv: unknown): TilesetJson => ({
    asset: { version: '1.1' },
    geometricError: 0,
    root: {
      content: { uri: 'root.glb' },
      geometricError: 0,
      children: [
        { boundingVolume: bv, geometricError: 0, content: { uri: 'case.glb' } },
        { boundingVolume: { box: FAR }, geometricError: 0, content: { uri: 'far.glb' } },
      ],
    },
  })

  const keptUris = (bv: unknown, sphere: CropSphere): string[] => {
    const out = cropTilesetForDataUri(makeBvTileset(bv), 'http://x.test/t.json', {
      keepSphere: sphere,
    })
    expect(out).not.toBeNull()
    // 裁剪公开面会把 uri 绝对化，故这里只比对文件名
    return out!.root.children!.map((c) => new URL(c.content!.uri!).pathname.split('/').pop()!)
  }

  it('球心在盒内 ⇒ 保留；对照 child 仍被剔除', () => {
    expect(keptUris({ box }, { center: [0, 0, 0], radius: 1 })).toEqual(['case.glb'])
  })

  it('球擦到盒角 ⇒ 保留（边界包含）', () => {
    // 角点 (10,10,10) 距原点 √300；球心在角外 1m 处、半径 √300 ⇒ 恰好相交
    const r = Math.sqrt(300)
    expect(keptUris({ box }, { center: [10 + r, 10, 10], radius: r })).toEqual(['case.glb'])
  })

  it('球在盒外且不接触 ⇒ 剔除', () => {
    expect(keptUris({ box }, { center: [100, 0, 0], radius: 1 })).toEqual([])
  })

  it('斜对角方向按最近点判，不用「球心距 ≤ 半径+最长半轴」的保守近似', () => {
    // 球心 (30,30,0)：到盒最近点 (10,10,0)，距离 √800 ≈ 28.284
    // 保守近似会算 |center| - 10 ≈ 42.43-10 = 32.43，半径 28 会被误判为相交
    expect(keptUris({ box }, { center: [30, 30, 0], radius: 28 })).toEqual([])
    expect(keptUris({ box }, { center: [30, 30, 0], radius: 28.3 })).toEqual(['case.glb'])
  })

  it('sphere 包围体按球心距 + 半径判', () => {
    expect(keptUris({ sphere: [0, 0, 0, 5] }, { center: [6, 0, 0], radius: 1 })).toEqual([
      'case.glb',
    ])
    expect(keptUris({ sphere: [0, 0, 0, 5] }, { center: [7, 0, 0], radius: 1 })).toEqual([])
  })

  it('无法识别的包围体一律保留（宁多留不误删）', () => {
    expect(keptUris(undefined, { center: [1e9, 0, 0], radius: 1 })).toEqual(['case.glb'])
    expect(keptUris({ box: [0, 0, 0] }, { center: [1e9, 0, 0], radius: 1 })).toEqual(['case.glb'])
  })
})

describe('cropTilesetForDataUri — 整包空间裁剪', () => {
  it('球外子树整棵剔除，球内保留且 uri 绝对化', () => {
    const src = makeDeepTileset()
    const out = cropTilesetForDataUri(src, 'http://x.test/static/x/tileset.json', {
      keepSphere: { center: [0, 0, 0], radius: 500 },
    })
    expect(out).not.toBeNull()
    // a（半轴 2000）与球相交 ⇒ 保留；b（1000）相交 ⇒ 保留；c（200）在内 ⇒ 保留
    expect(out!.root.children).toHaveLength(1)
    const a = out!.root.children![0]
    expect(a.content!.uri).toBe('http://x.test/static/x/a.glb')
    expect(a.children![0].children![0].content!.uri).toBe('http://x.test/static/x/c.glb')
  })

  it('落位不变量：root 的 transform / boundingVolume 与整包逐位相同（GE 另行重锚）', () => {
    const src = makeDeepTileset()
    const out = cropTilesetForDataUri(src, 'http://x.test/x/tileset.json', {
      keepSphere: { center: [0, 0, 0], radius: 500 },
    })
    expect(out!.root.transform).toEqual(src.root.transform)
    expect(out!.root.boundingVolume).toEqual(src.root.boundingVolume)
    // 空间裁剪本身不动 GE；但公开入口 cropTilesetForDataUri 含 GE 重锚（见上一 describe），
    // 故此处只钉「不低于原值」，等值锚定由 normalizeTilesetGeometricError 的用例负责
    expect(out!.root.geometricError).toBeGreaterThanOrEqual(src.root.geometricError ?? 0)
  })

  it('球远离全部内容 ⇒ 返回 null（不返回空树）', () => {
    const src = makeDeepTileset()
    const out = cropTilesetForDataUri(src, 'http://x.test/x/tileset.json', {
      keepSphere: { center: [100000, 0, 0], radius: 10 },
    })
    expect(out).toBeNull()
  })

  it('dropContent 只摘内容、保留子树（与 drop 的连子树删相反）', () => {
    const src = makeDeepTileset()
    const out = cropTilesetForDataUri(src, 'http://x.test/x/tileset.json', {
      dropContent: (n) => nodeName(n) === 'root' || nodeName(n) === 'a',
    })
    expect(out).not.toBeNull()
    // root 与 a 的内容被摘掉
    expect(out!.root.content).toBeUndefined()
    const a = out!.root.children![0]
    expect(a.content).toBeUndefined()
    // 但子树照常在，b / c 的内容仍在
    expect(a.children![0].content!.uri).toBe('http://x.test/x/b.glb')
    expect(a.children![0].children![0].content!.uri).toBe('http://x.test/x/c.glb')
  })

  it('dropContent 摘掉全部内容 ⇒ 返回 null', () => {
    const src = makeDeepTileset()
    const out = cropTilesetForDataUri(src, 'http://x.test/x/tileset.json', {
      dropContent: () => true,
    })
    expect(out).toBeNull()
  })

  it('drop 与 keepSphere 可叠加：drop 优先整棵删', () => {
    const src = makeDeepTileset()
    const out = cropTilesetForDataUri(src, 'http://x.test/x/tileset.json', {
      keepSphere: { center: [0, 0, 0], radius: 5000 },
      drop: (n) => nodeName(n) === 'a',
    })
    // a 整棵被删；root 自身仍有内容 ⇒ 结果非 null，但 children 空
    expect(out).not.toBeNull()
    expect(out!.root.children).toHaveLength(0)
    expect(out!.root.content!.uri).toBe('http://x.test/x/root.glb')
  })

  it('纯函数：不改入参', () => {
    const src = makeDeepTileset()
    const before = JSON.stringify(src)
    cropTilesetForDataUri(src, 'http://x.test/x/tileset.json', {
      keepSphere: { center: [0, 0, 0], radius: 500 },
    })
    expect(JSON.stringify(src)).toBe(before)
  })
})

describe('hasAnyContent / cropTilesetForDataUri', () => {
  // hasAnyContent 已收为模块内部（公开面入口 = cropTilesetForDataUri）：这里用它的
  // 「整棵树一个带 content 的节点都不剩 ⇒ 返回 null」间接钉住「自身与任意后代都算数」。
  const cropOf = (root: TilesetNode): TilesetJson | null =>
    cropTilesetForDataUri(
      { asset: { version: '1.1' }, geometricError: 0, root },
      'http://x.test/t.json'
    )

  it('hasAnyContent 认自身与任意后代（经 cropTileset 的非 null / null 判定）', () => {
    expect(cropOf({ content: { uri: 'x.glb' } })).not.toBeNull()
    expect(cropOf({ children: [{ content: { uri: 'x.glb' } }] })).not.toBeNull()
    expect(cropOf({ children: [{ children: [] }] })).toBeNull()
    expect(cropOf({ content: {} })).toBeNull()
  })

  it('cropTilesetForDataUri = 裁剪 + GE 校正', () => {
    const src = makeDeepTileset()
    const out = cropTilesetForDataUri(src, 'http://x.test/x/tileset.json', {
      keepSphere: { center: [0, 0, 0], radius: 500 },
    })
    expect(out).not.toBeNull()
    // GE 被抬到包围体尺度（root 半轴 4000 ⇒ 8000）
    expect(out!.root.geometricError).toBe(8000)
  })

  it('cropTilesetForDataUri 剪空时返回 null', () => {
    const src = makeDeepTileset()
    expect(
      cropTilesetForDataUri(src, 'http://x.test/x/tileset.json', {
        keepSphere: { center: [1e6, 0, 0], radius: 1 },
      })
    ).toBeNull()
  })
})

// 摘空层折叠（collapseEmptyLevels）+ root GE 上压（capRootGeometricError）：
// 「粗层摘内容后，空层仍被选为遍历终点 ⇒ 远景整层空白」的机制修复。
// 运行时阶梯实测与变异红样见 docs/3dtiles-改造任务表.md §8.15；这里钉的是机制本身。
describe('cropTilesetForDataUri — 摘空层折叠与 root GE 上压', () => {
  const DROP_A_B = (n: TilesetNode) => nodeName(n) === 'a' || nodeName(n) === 'b'
  const OPTS = { dropContent: DROP_A_B, collapseEmptyLevels: true, capRootGeometricError: true }

  it('collapseEmptyLevels：被摘空的中间层折叠掉，子节点上提（终点必有内容）', () => {
    const out = cropTilesetForDataUri(makeDeepTileset(), 'http://x.test/x/tileset.json', {
      dropContent: DROP_A_B,
      collapseEmptyLevels: true,
    })
    expect(out).not.toBeNull()
    // a、b 两层被摘空 ⇒ 折叠后 root 直属只剩带内容的叶子 c
    expect((out!.root.children ?? []).map((n) => nodeName(n))).toEqual(['c'])
    // 全树不再有「既没内容、又有子节点」的节点——那正是会被选成空终点的形态
    const noEmptyEndpoint = (n: TilesetNode): boolean =>
      (!!n.content || (n.children?.length ?? 0) === 0) && (n.children ?? []).every(noEmptyEndpoint)
    expect(noEmptyEndpoint(out!.root)).toBe(true)
    // 阳性对照：不折叠时 a 仍在树上且没内容（旧形态）
    const legacy = cropTilesetForDataUri(makeDeepTileset(), 'http://x.test/x/tileset.json', {
      dropContent: DROP_A_B,
    })
    expect(nodeName(legacy!.root.children![0])).toBe('a')
    expect(legacy!.root.children![0].content).toBeUndefined()
  })

  it('capRootGeometricError：root GE 压到被摘空层的上确界（a 半轴 2000 ⇒ 4000）', () => {
    const out = cropTilesetForDataUri(makeDeepTileset(), 'http://x.test/x/tileset.json', OPTS)
    // 空层 a ⇒ 4000、b ⇒ 2000，上确界 4000；不压的话 root 是整包尺度 8000
    expect(out!.root.geometricError).toBe(4000)
    // 不传 topGeometricErrorFloor 时顶层字段保持归一化值 8000。注意顶层字段不是装饰：
    // Cesium 访问 root 前的整层早退读的正是它（root 无 parent ⇒ tileset._scaledGeometricError），
    // 与 root 自身 GE（决定何时细化）是两个量——港区因此必须同时设下限（见下一条用例）。
    expect(out!.geometricError).toBe(8000)
    const noCap = cropTilesetForDataUri(makeDeepTileset(), 'http://x.test/x/tileset.json', {
      dropContent: DROP_A_B,
      collapseEmptyLevels: true,
    })
    expect(noCap!.root.geometricError).toBe(8000)
  })

  it('topGeometricErrorFloor：只抬顶层 geometricError（整层早退闸门输入），不动 root GE', () => {
    const src = makeDeepTileset()
    const out = cropTilesetForDataUri(src, 'http://x.test/x/tileset.json', {
      ...OPTS,
      topGeometricErrorFloor: 30000,
    })
    // 顶层被抬到下限；root 仍是被摘空层上确界 4000（LOD 切换距离不受影响）
    expect(out!.geometricError).toBe(30000)
    expect(out!.root.geometricError).toBe(4000)
    // 下限低于现值时不动作（不许把已更大的顶层值压回去）
    const low = cropTilesetForDataUri(src, 'http://x.test/x/tileset.json', {
      ...OPTS,
      topGeometricErrorFloor: 100,
    })
    expect(low!.geometricError).toBe(8000)
    // 不传该项 ⇒ 顶层保持归一化值（老行为不变）
    const none = cropTilesetForDataUri(src, 'http://x.test/x/tileset.json', OPTS)
    expect(none!.geometricError).toBe(8000)
  })

  it('没摘空任何层 ⇒ cap 不生效（不臆造上限），结果与不传两项时逐位相同', () => {
    const src = makeDeepTileset()
    const capped = cropTilesetForDataUri(src, 'http://x.test/x/tileset.json', {
      ...OPTS,
      dropContent: () => false,
    })
    const plain = cropTilesetForDataUri(src, 'http://x.test/x/tileset.json', {})
    expect(capped!.root.geometricError).toBe(8000)
    expect(JSON.stringify(capped!.root)).toBe(JSON.stringify(plain!.root))
  })
})

// 统一 LOD 切换口径（公开入口 = normalizeTilesetGeometricError 的 refineGeometricError 选项）：
// 把「带内容 + 有子节点」的节点（细化开关）GE 设为统一值 ⇒ 多资产在同一相机距离切换粗精。
// 机制、实测与失效条件见 beibu3dTiles 的 LOD_REFINE_GE_PER_SSE；这里钉机制本身。
describe('setRefineSwitchGeometricError / refineGeometricError — 统一 LOD 切换口径', () => {
  it('只设「带内容 + 有子节点」的节点；叶子/纯容器/顶层字段一律不动', () => {
    const src: TilesetJson = {
      asset: { version: '1.1', generator: 'test' },
      geometricError: 5000,
      root: {
        geometricError: 3000,
        content: { uri: 'shell.glb' },
        children: [
          {
            geometricError: 900,
            content: { uri: 'mid.glb' },
            children: [{ geometricError: 0, content: { uri: 'leaf.glb' } }],
          },
          // 纯容器：没内容、有子节点——它不是渲染终点，压小它会把遍历停在"没内容"的层
          {
            geometricError: 800,
            children: [{ geometricError: 0, content: { uri: 'leaf2.glb' } }],
          },
        ],
      },
    }
    const before = JSON.stringify(src)
    // setRefineSwitchGeometricError 已收为模块内部；带 refineGeometricError 的 normalize 是它的公开入口
    const out = normalizeTilesetGeometricError(src, { refineGeometricError: 777 })
    const root = out.root
    const [mid, container] = root.children!
    expect(root.geometricError).toBe(777) // 开关①（远景壳）
    expect(mid.geometricError).toBe(777) // 开关②
    expect(mid.children![0].geometricError).toBe(0) // 叶子不动
    expect(container.geometricError).toBe(800) // 纯容器不动
    expect(container.children![0].geometricError).toBe(0)
    // 顶层（整层早退闸门输入）不归本项管：normalize 只做 max 抬升，此树无包围体 ⇒ 尺度 0 ⇒ 保持 5000
    expect(out.geometricError).toBe(5000)
    expect(JSON.stringify(src)).toBe(before) // 纯函数：不改入参
  })

  it('值 ≤ 0 ⇒ 细化开关一律不动（不误设；调用方据此不传也不生效）', () => {
    // normalize 走 max 抬升后 root 尺度为 8000；refine 值 ≤ 0 时必须仍是 8000，而不是 0 / -1
    for (const bad of [0, -1]) {
      expect(
        normalizeTilesetGeometricError(makeDeepTileset(), { refineGeometricError: bad }).root
          .geometricError
      ).toBe(8000)
    }
  })

  it('normalize 带选项：尺度抬升后统一细化开关；不带选项保持旧行为', () => {
    const src = makeDeepTileset()
    const plain = normalizeTilesetGeometricError(src)
    expect(plain.root.geometricError).toBe(8000) // 半轴 4000 ⇒ 内部节点抬到尺度 8000
    const unified = normalizeTilesetGeometricError(src, { refineGeometricError: 1000 })
    expect(unified.root.geometricError).toBe(1000)
    expect(unified.root.children![0].geometricError).toBe(1000) // a 也是开关
    expect(unified.root.children![0].children![0].children![0].geometricError).toBe(0) // c 是叶子
  })

  it('cropTilesetForDataUri：refine 覆盖 cap（策略值优先于数据自派生值）', () => {
    const src = makeDeepTileset()
    const capped = cropTilesetForDataUri(src, 'http://x.test/x/tileset.json', {
      dropContent: () => false,
      capRootGeometricError: true,
      collapseEmptyLevels: true,
    })
    expect(capped!.root.geometricError).toBe(8000) // 没摘空 ⇒ cap 不生效，仍是尺度值
    const unified = cropTilesetForDataUri(src, 'http://x.test/x/tileset.json', {
      refineGeometricError: 500,
    })
    expect(unified!.root.geometricError).toBe(500)
    expect(unified!.root.children![0].geometricError).toBe(500)
  })
})

// D3 去 export：六个仅内部消费的符号已收为模块内部。
// 本组是「公开面收窄」本身的判据——任何形式的再导出（export 关键字或 export { … } 列表）都必须红。
describe('公开面收窄 — 六个内部符号不得再导出', () => {
  const INTERNAL = [
    'nodeUri',
    'resolveUri',
    'boundingIntersectsSphere',
    'setRefineSwitchGeometricError',
    'hasAnyContent',
    'cropTileset',
  ]
  const PUBLIC = ['cropTilesetForDataUri', 'normalizeTilesetGeometricError', 'deriveGroupTileset']

  it('内部符号不在模块公开面；公开符号仍在（阳性对照）', async () => {
    const mod = (await import('../tiles3dGroups')) as unknown as Record<string, unknown>
    for (const k of INTERNAL) expect(mod[k], k + ' 应已收为模块内部').toBeUndefined()
    // 阳性对照：漏掉它时，整模块导入失败或名字打错也会让上面全绿
    for (const k of PUBLIC) expect(typeof mod[k], k + ' 应仍是公开面').toBe('function')
  })
})

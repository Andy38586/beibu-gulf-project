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
  deriveGroupTileset,
  nodeName,
  nodeUri,
  resolveUri,
  tallyGroups,
  toDataUri,
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
  it('nodeUri 兼容 content.uri 与旧版 content.url', () => {
    expect(nodeUri({ content: { uri: 'a.glb' } })).toBe('a.glb')
    expect(nodeUri({ content: { url: 'b.glb' } })).toBe('b.glb')
    expect(nodeUri({})).toBeUndefined()
  })

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

describe('resolveUri — 相对路径绝对化', () => {
  it('站点相对基准 → 拼出同源绝对路径', () => {
    expect(resolveUri('/static/x/tiles/tileset.json', 'alpha.glb')).toBe(
      '/static/x/tiles/alpha.glb'
    )
  })

  it('带协议前缀的基准 → 保留协议与主机', () => {
    expect(resolveUri('https://x.test/a/b/tileset.json', 'c.glb')).toBe('https://x.test/a/b/c.glb')
  })

  it('已是绝对地址（http/data/blob）→ 原样返回', () => {
    for (const u of [
      'http://a/b.glb',
      'https://a/b.glb',
      'data:application/octet-stream;base64,AA',
    ]) {
      expect(resolveUri('/static/tileset.json', u)).toBe(u)
    }
  })

  it('uri 以斜杠开头按站点根相对处理（不拼基准目录）', () => {
    expect(resolveUri('/static/x/tiles/tileset.json', '/static/y.glb')).toBe('/static/y.glb')
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
        expect(u.startsWith('/static/x/tiles/')).toBe(true)
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
    expect(content.uri).toBe('/static/x/tiles/legacy.glb')
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

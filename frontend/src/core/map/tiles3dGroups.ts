/**
 * 3D Tiles 分组派生（通用能力，**不含任何业务语义**）。
 *
 * ## 为什么需要它
 *
 * 瓦片集是**一棵树**：root 无 content、直属若干 child，每个 child 下再挂分区子瓦片。
 * 而 Cesium 的 `Cesium3DTileset.fromUrl(url)` 是**整包加载**：给一个 tileset.json
 * 就吃下整棵树，界面上只能得到一个总开关。用户想「只看其中某一部分」时无从下手。
 *
 * ## 做法：客户端派生，不切分服务端文件
 *
 * 从同一份 tileset.json 派生「只保留某分组子树」的 tileset，再交给 fromUrl。
 * 三个关键点：
 *
 * 1. **不能让 root 的 content 缺位**：本形态的瓦片集 root 本就没有 content（纯容器），
 *    所以裁剪 children 即可，root 的 transform / boundingVolume 原样继承——
 *    **分组瓦片与整包瓦片的绝对落位逐位相同**（这是本模块最重要的不变量）。
 * 2. **content.uri 必须重写成绝对 URL**：派生后的 JSON 以 Data URI 交给 Cesium，
 *    而 `Cesium3DTileset.fromUrl` 在 `resource.isDataUri` 分支把 basePath 设为 `""`，
 *    相对 uri 会相对空基准解析而 404。故此处一律用基准 URL 拼成绝对地址。
 * 3. **Data URI 体积可控**：派生 JSON 只含被选中的子树，不含 BIN——不会有 URI 长度问题。
 *
 * ## 本模块的边界（04 清单 E5：core 不得含业务语义）
 *
 * 分组「有哪些」「叫什么」「怎么判定」全部由**调用方**（business 层）以谓词传入。
 * 本模块只提供与业务无关的机制：按谓词裁子树、uri 绝对化、编 Data URI、统计归属。
 * 故此处不出现任何业务名、中文标签或按业务字符串分支的判定。
 *
 * ## 为什么不给每个分组生成独立 tileset.json 文件
 *
 * 那需要 N 个新文件 + N 份重复的 boundingVolume/transform，且模型一重烘就要
 * 同步重生成（本项目已有一次「模板覆盖导致索引失真」的事故）。派生是纯函数，
 * 无落盘、无同步负担，且能被单测钉死。
 */

/** tileset 节点（只声明本模块用到的字段，避免与 Cesium 类型耦合） */
export interface TilesetNode {
  content?: { uri?: string; url?: string }
  children?: TilesetNode[]
  extras?: Record<string, unknown>
  transform?: number[]
  boundingVolume?: unknown
  geometricError?: number
  refine?: string
}

/** 最小 tileset 结构 */
export interface TilesetJson {
  asset: { version: string; generator?: string }
  geometricError: number
  root: TilesetNode
  [k: string]: unknown
}

/**
 * 分组定义（**由调用方提供**，本模块不内置任何具体分组）。
 *
 * 泛型 `Id` 让调用方用自己的 id 字面量联合类型（如业务分组 id），
 * 本模块不关心其取值空间。
 */
export interface GroupSpec<Id extends string = string> {
  id: Id
  /** 面板/日志显示名（业务文案由调用方给） */
  label: string
  /** 该分组的判定（对 root 直属 child 求值） */
  match: (child: TilesetNode) => boolean
}

/** 取节点 uri（兼容 content.uri 与旧版 content.url） */
export function nodeUri(n: TilesetNode): string | undefined {
  const u = n.content?.uri ?? n.content?.url
  return u ? String(u) : undefined
}

/**
 * 取节点显示名（extras.name）。
 *
 * 供调用方写谓词时复用——extras 是建模器写入的语义标注，比文件名约定稳定。
 * 本函数只做「读一个约定字段」这一机械动作，不含任何业务判断。
 */
export function nodeName(n: TilesetNode): string {
  const v = n.extras?.name
  return typeof v === 'string' ? v : ''
}

/**
 * 把相对 uri 解析为绝对 URL。
 *
 * 三种输入，语义不同（RFC 3986）：
 * - `http://…` / `data:…` / `blob:…` 等带 scheme → 已是绝对地址，原样返回；
 * - `/static/x.glb` 以斜杠开头 → **站点根相对**，直接就是目标路径（不能再拼基准目录，
 *   否则会得到 `/static/pinglu/tiles/static/x.glb` 这种错地址）；
 * - `madao-low.glb` 普通相对路径 → 拼基准的目录部分。
 *
 * ⚠ 不能用 `new URL(uri, base)` 直接拼：base 是 "/static/.../tileset.json" 这类
 * **站点相对路径**时，`new URL` 需要绝对基准。此处用字符串处理，
 * 与 Cesium `Resource.getBaseUri(true)` 的语义一致，且不依赖 location。
 */
export function resolveUri(baseUrl: string, uri: string): string {
  // 已是绝对地址：原样返回
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) return uri
  // 站点根相对：以 / 开头，不拼基准目录
  if (uri.startsWith('/')) return uri
  const idx = baseUrl.lastIndexOf('/')
  const dir = idx >= 0 ? baseUrl.slice(0, idx + 1) : ''
  return dir + uri
}

/** 递归把子树里的 content.uri 换成绝对 URL */
function absolutizeNode(node: TilesetNode, baseUrl: string): TilesetNode {
  const out: TilesetNode = { ...node }
  const uri = nodeUri(node)
  if (uri && node.content) {
    const resolved = resolveUri(baseUrl, uri)
    out.content = { ...node.content, uri: resolved }
    // 兼容字段一并清掉，避免 Cesium 读到旧相对路径
    delete (out.content as { url?: string }).url
  }
  if (Array.isArray(node.children)) {
    out.children = node.children.map((c) => absolutizeNode(c, baseUrl))
  }
  return out
}

/**
 * 从完整瓦片集派生某个分组。
 *
 * 保留：asset / geometricError / root 的 transform、boundingVolume、geometricError、refine、extras
 * 裁剪：root.children 只留命中该分组的节点（含其全部子树）
 * 重写：所有 content.uri → 绝对 URL
 *
 * @returns 派生后的 tileset；分组无命中时返回 null（**不返回空 children 的 tileset**——
 *          那会让 Cesium 建出一个永远无内容的瓦片集，表现为「图层开着但什么都没有」）
 */
export function deriveGroupTileset<Id extends string>(
  tileset: TilesetJson,
  group: GroupSpec<Id>,
  baseUrl: string
): TilesetJson | null {
  const root = tileset.root
  if (!root || !Array.isArray(root.children)) return null

  const picked = root.children.filter((c) => group.match(c))
  if (picked.length === 0) return null

  return {
    ...tileset,
    root: {
      ...root,
      // 只保留命中子树；子树内部再走一遍 uri 绝对化
      children: picked.map((c) => absolutizeNode(c, baseUrl)),
    },
  }
}

/** 把派生结果编成 Data URI（Cesium fromUrl 可直读） */
export function toDataUri(tileset: TilesetJson): string {
  const json = JSON.stringify(tileset)
  // btoa 只吃 latin1：中文 extras.name 必须先转 UTF-8 字节再逐字节编码
  const bytes = new TextEncoder().encode(json)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return `data:application/json;base64,${btoa(bin)}`
}

/**
 * 统计各分组命中的直属 child 数量（供调用方自检与测试断言完整性：
 * 所有分组命中数之和 + 未归属数 应等于 root.children.length，避免分漏）。
 *
 * 一个 child 命中多组时计入**首个**命中者——故调用方的分组表顺序即优先级，
 * 重叠判定（如「桥」既属走廊又要单独拆出）的排他性由调用方在谓词里或靠顺序表达。
 */
export function tallyGroups<Id extends string>(
  tileset: TilesetJson,
  groups: readonly GroupSpec<Id>[]
): { counts: Record<string, number>; unassigned: string[] } {
  const counts: Record<string, number> = {}
  for (const g of groups) counts[g.id] = 0
  const unassigned: string[] = []
  for (const c of tileset.root?.children ?? []) {
    const hit = groups.filter((g) => g.match(c))
    if (hit.length === 0) {
      unassigned.push(nodeUri(c) ?? '(no-uri)')
      continue
    }
    // 命中多组时计入首个（分组表按优先级排列）
    counts[hit[0].id] += 1
  }
  return { counts, unassigned }
}

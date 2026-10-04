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
 * 把相对 uri 解析为**scheme 级绝对 URL**。
 *
 * 三种输入，语义不同（RFC 3986）：
 * - `http://…` / `data:…` / `blob:…` 等带 scheme → 已是绝对地址，原样返回；
 * - `/static/x.glb` 以斜杠开头 → **站点根相对**；
 * - `madao-low.glb` 普通相对路径 → 拼基准的目录部分。
 *
 * ⚠ 为什么站点根相对还不够（2026-09-26 实测缺陷，曾致运河 5 组瓦片静默零渲染）：
 * 派生结果以 Data URI 交给 `Cesium3DTileset.fromUrl`，Cesium 在 `resource.isDataUri`
 * 分支把 basePath 设为 `""`——站点根相对 uri 被拼成 `data:///static/…` 畸形地址，
 * 内容 404、图层开着但什么都没有。故有浏览器环境（location 可用）时必须补全到
 * `origin + path`；无 location（单测/node）退回站点根相对。
 */
export function resolveUri(baseUrl: string, uri: string): string {
  // 已是绝对地址：原样返回
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) return uri
  const idx = baseUrl.lastIndexOf('/')
  const dir = idx >= 0 ? baseUrl.slice(0, idx + 1) : ''
  const path = uri.startsWith('/') ? uri : dir + uri
  const href = (globalThis as { location?: { href?: string } }).location?.href
  if (href && path.startsWith('/')) {
    try {
      return new URL(path, href).toString()
    } catch {
      return path
    }
  }
  return path
}

/**
 * 空间裁剪球（**tileset 局部坐标系**，与 `boundingVolume` 同系）。
 *
 * 用局部系而不是经纬度的理由：瓦片集只有 root 带 `transform`（实测钦州港 96 个
 * 节点里仅 root 有），子节点包围盒一律是局部系的轴对齐盒；局部系即「以 root 原点
 * 为原点的 ENU」。这样裁剪判据是纯算术，不引入投影/椭球依赖。
 */
export interface CropSphere {
  center: [number, number, number]
  radius: number
}

/** 取盒的三条半轴向量（列优先 12 元组：中心 3 + 三个半轴各 3） */
function boxAxes(box: number[]): {
  c: [number, number, number]
  axes: [number[], number[], number[]]
} {
  return {
    c: [box[0], box[1], box[2]],
    axes: [
      [box[3], box[4], box[5]],
      [box[6], box[7], box[8]],
      [box[9], box[10], box[11]],
    ],
  }
}

/**
 * 盒与球是否相交（OBB vs 球，精确判据：球心到盒的最近点距离 ≤ 半径）。
 *
 * 为什么不用「球心到盒心距离 ≤ 半径 + 最长半轴」：那是保守近似，会把一整圈
 * 斜对角上明显在球外的盒也留下——裁剪后体积降不下来。此处按半轴投影取最近点，
 * 判据与盒的朝向无关，对轴对齐与非轴对齐盒同样成立。
 *
 * 无法识别包围体（既非 12 元盒也非 4 元球）时返回 `true`（**保留**）：
 * 宁可多留也不误删——误删的后果是「图层开着但内容缺一块」，比多留难发现得多。
 */
export function boundingIntersectsSphere(bv: unknown, sphere: CropSphere): boolean {
  const b = bv as { box?: number[]; sphere?: number[] } | undefined
  if (b?.sphere && b.sphere.length >= 4) {
    const d = Math.hypot(
      b.sphere[0] - sphere.center[0],
      b.sphere[1] - sphere.center[1],
      b.sphere[2] - sphere.center[2]
    )
    return d <= sphere.radius + b.sphere[3]
  }
  if (!b?.box || b.box.length < 12) return true
  const { c, axes } = boxAxes(b.box)
  const d = [sphere.center[0] - c[0], sphere.center[1] - c[1], sphere.center[2] - c[2]]
  let best = 0
  for (const ax of axes) {
    const len = Math.hypot(ax[0], ax[1], ax[2])
    if (len === 0) continue
    const u = [ax[0] / len, ax[1] / len, ax[2] / len]
    const proj = d[0] * u[0] + d[1] * u[1] + d[2] * u[2]
    const t = Math.max(-len, Math.min(len, proj))
    best += (proj - t) ** 2
  }
  return Math.sqrt(best) <= sphere.radius
}

/** 递归把子树里的 content.uri 换成绝对 URL；`drop` 命中的节点连同子树一并剔除（返回 null） */
function absolutizeNode(
  node: TilesetNode,
  baseUrl: string,
  drop?: (node: TilesetNode) => boolean,
  keepSphere?: CropSphere,
  dropContent?: (node: TilesetNode) => boolean
): TilesetNode | null {
  if (drop?.(node)) return null
  if (keepSphere && !boundingIntersectsSphere(node.boundingVolume, keepSphere)) return null
  const out: TilesetNode = { ...node }
  if (dropContent?.(node)) {
    // 只摘内容、保留子树：粗层（如钦州港 d0~d3 的 water/opaque）盖住整片区域，
    // 删内容即可，不能删节点——节点一删，其下 d4/d5 的精细瓦片会跟着整棵消失。
    delete out.content
  } else {
    const uri = nodeUri(node)
    if (uri && node.content) {
      const resolved = resolveUri(baseUrl, uri)
      out.content = { ...node.content, uri: resolved }
      // 兼容字段一并清掉，避免 Cesium 读到旧相对路径
      delete (out.content as { url?: string }).url
    }
  }
  if (Array.isArray(node.children)) {
    out.children = node.children
      .map((c) => absolutizeNode(c, baseUrl, drop, keepSphere, dropContent))
      .filter((c): c is TilesetNode => c !== null)
  }
  return out
}

/** 派生选项 */
export interface DeriveOptions {
  /**
   * 剪枝谓词：返回 `true` 的节点**连同其子树**一并剔除。
   *
   * 与 `GroupSpec.match`（选层，只作用于 root 直属 child）的分工：`match` 决定
   * 「要哪一棵子树」，`drop` 决定「这棵子树里哪些内容不要」，二者正交且可叠加。
   *
   * 为什么需要它（2026-09-28 项目内实测）：交付包的枢纽瓦片自带一层
   * 「地形与边坡」（`*-z1-terrain.glb`，`extras.name` 含该子串），那是用
   * Copernicus DEM 生成的**局部地表**。本项目的真地形来自 CTB（ASTER GDEM 派生 +
   * 海陆掩膜），两者不同源、高程必然不一致——同时开启时表现为一块斜插进地形的平板
   * （实测侧视可见硬直交界与互相穿插）。剔除它，闸室/闸门/引航道等**构筑物**便落回
   * 项目地形上：**地形归地形，构筑物归构筑物**，不在渲染层叠两层地表。
   */
  drop?: (node: TilesetNode) => boolean
  /**
   * 空间裁剪：只保留与给定球相交的子树，完全在球外的节点**连同子树**剔除。
   *
   * 为什么需要它（2026-10-03 实测）：钦州港交付包覆盖 16×18 km，d0~d3 共 85 块
   * 全是 `water/opaque` 的粗层地表（含 30.3 M m² 水面与地形），真正的地物
   * （`cargo` 集装箱 / `metal` 龙门架）只出现在作业区的 d4/d5 共 6 块里。
   * 不做空间裁剪时整包 143.5 MB 全下，界面上就是"一整块瓦片"。
   *
   * 与 `drop` 的分工：`drop` 按**语义**剪枝（如剔自带地表层），
   * `keepSphere` 按**位置**剪枝，二者正交可叠加。
   */
  keepSphere?: CropSphere
  /**
   * 只剔除**内容**、保留子树（与 `drop` 的"连子树一起删"相反）。
   *
   * 为什么需要它：粗层节点盖住整片区域，但它是精细子瓦片的**唯一通路**——
   * 节点一删，其下 d4/d5 跟着整棵消失。要"不要粗层、只要精细层"，只能删内容
   * 不能删节点。命中者去掉 `content`，`children` 照常保留。
   */
  dropContent?: (node: TilesetNode) => boolean
  /**
   * **把 root 的 geometricError 压到「被 dropContent 摘空各层 GE 的上确界」**（= 其中
   * 最浅、数值最大的一级；deepest 一级数值最小，不是这个值）。
   *
   * 为什么（2026-10-04 运行时阶梯实测）：`dropContent` 摘空的层级**仍然会被选为终点**——
   * 相机越远、屏幕误差越小，遍历就越浅，最后停在空层上 ⇒ 整层空白。
   * 钦州港实测：80 km 与 586 km（= 页面默认全域视角）整层空白，而同场景三枢纽 6/6 档全在场，
   * 用户说的"LOD 不一致"就是这个。压在空层 GE 之下后，root（有内容）在所有"空层本会成为
   * 终点"的距离上就是终点，于是远景有主体、中近景照旧细化到精细层，且不会出现多层同时渲染。
   *
   * 数值取自**被摘空节点的 GE 上确界**（不手抄常数）；无节点被摘空时本项不生效。
   * 取上确界而不是下确界，是为了在"远景有壳"的前提下**尽早**恢复精细层——取下确界会把
   * 精细层的出现距离推得更近，近/中景形态会比改前更粗（与 §8.15 实测阶梯不符）。
   */
  capRootGeometricError?: boolean
  /**
   * **折叠掉没有内容的中间层**：把"内容被摘空、但有子节点"的节点的子节点提升到其父节点。
   *
   * 为什么（2026-10-04）：`dropContent` 摘空的层仍留在树上，且**会被选为遍历终点** ⇒
   * 那些距离上整层空白（钦州港实测 56 km 以外全空，含页面默认全域视角）。
   * 折叠后树变成「有内容的 root → 有内容的叶子」，终点必有内容；配合
   * `capRootGeometricError` 把 root 的 GE 压到被摘空层的水平，远距离就落在 root 上、
   * 近距离才细化到叶子 —— 且不会破坏 geometricError 沿树单调递减的不变量
   * （直接压 root 而不折叠会破坏它，实测遍历会停在 root、精细层永不加载）。
   */
  collapseEmptyLevels?: boolean
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
  baseUrl: string,
  options: DeriveOptions = {}
): TilesetJson | null {
  const root = tileset.root
  if (!root || !Array.isArray(root.children)) return null
  if (options.drop?.(root)) return null

  const picked = root.children.filter(
    (c) =>
      group.match(c) &&
      !options.drop?.(c) &&
      (!options.keepSphere || boundingIntersectsSphere(c.boundingVolume, options.keepSphere))
  )
  if (picked.length === 0) return null

  return {
    ...tileset,
    root: {
      ...root,
      // 只保留命中子树；子树内部再走一遍 uri 绝对化（并按 drop / keepSphere 剪枝）
      children: picked
        .map((c) =>
          absolutizeNode(c, baseUrl, options.drop, options.keepSphere, options.dropContent)
        )
        .filter((c): c is TilesetNode => c !== null),
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
 * 取包围体的世界尺度（米，最大方向直径）。
 *
 * box：三个半轴向量长度取最大 ×2。tileset 的 transform 只做旋转+平移、不含缩放
 * （tiles3d-check 守卫已钉死），故局部半轴长度即世界长度，无需叠加 transform。
 * sphere：直径。无法识别时返回 0（调用方据此跳过，不臆造尺度）。
 */
function boundingWorldScale(bv: unknown): number {
  const b = bv as { box?: number[]; sphere?: number[] } | undefined
  if (b?.box && b.box.length >= 12) {
    const x = b.box
    const lx = Math.hypot(x[3], x[4], x[5])
    const ly = Math.hypot(x[6], x[7], x[8])
    const lz = Math.hypot(x[9], x[10], x[11])
    return 2 * Math.max(lx, ly, lz)
  }
  if (b?.sphere && b.sphere.length >= 4) return 2 * b.sphere[3]
  return 0
}

/** 递归校正节点 GE：内部节点（有非空 children）抬到 max(原值, 包围体世界尺度)；叶子保持原值 */
function normalizeNode(node: TilesetNode): TilesetNode {
  const out: TilesetNode = { ...node }
  if (Array.isArray(node.children) && node.children.length > 0) {
    out.children = node.children.map(normalizeNode)
    const scale = boundingWorldScale(node.boundingVolume)
    if (scale > 0) out.geometricError = Math.max(node.geometricError ?? 0, scale)
  }
  return out
}

/**
 * 校正 tileset 各节点 geometricError（纯函数，不改入参）。
 *
 * ## 为什么需要
 *
 * 外部交付瓦片的 geometricError 普遍相对其包围体尺度偏小 1~2 个数量级（实测：
 * root 包围 ~18km 而 GE 仅 256m；运河 root 包围 ~100km 而 GE 仅 1200m）。Cesium 以
 * `SSE = GE·drawingBufferHeight / (distance·sseDenominator)` 判定是否下钻：
 * SSE ≤ maximumScreenSpaceError 即在该节点终止遍历。GE 偏小 ⇒ 相机在中高空算出的 SSE
 * 已低于阈值，Cesium 在 root 提前 return、不执行遍历，root 与子内容都不被选中
 * （`statistics.visited = 0`），图层开着却整片空白。
 *
 * ## 规则（与 Cesium 标准 tileset「GE 与包围体同量级」一致）
 *
 * - 内部节点（有 children）：`GE = max(原值, 包围体世界尺度)`；
 * - 叶子节点：保持原值（最精细层 GE 通常为 0；抬它反而要求继续细化）。
 *
 * transform / boundingVolume / content 一律不动 ⇒ 落位不变，仅改变 LOD 切换高度。
 */
export function normalizeTilesetGeometricError(tileset: TilesetJson): TilesetJson {
  const root = normalizeNode(tileset.root)
  const scale = boundingWorldScale(root.boundingVolume)
  const geometricError = Math.max(tileset.geometricError ?? 0, scale)
  return { ...tileset, root, geometricError }
}

/** 子树里是否还剩至少一个带 content 的节点（含 root 自身） */
export function hasAnyContent(node: TilesetNode): boolean {
  if (node.content && nodeUri(node)) return true
  return (node.children ?? []).some(hasAnyContent)
}

/**
 * 整包裁剪：对**整棵树**（含 root）施加 `keepSphere` / `dropContent` / `drop`，
 * 并把保留下来的 content.uri 绝对化。
 *
 * 与 `deriveGroupTileset` 的分工：后者先按分组挑 root.children 再剪枝，用于
 * 「一包多组、按组开关」；本函数**不分组**，用于「只要某一区域」的整包裁剪。
 *
 * root 的 transform / boundingVolume / geometricError 原样继承 ⇒ 裁剪结果与整包
 * **绝对落位逐位相同**（本模块最重要的不变量，与 deriveGroupTileset 同款）。
 *
 * @returns 裁剪后的 tileset；**内容被剪空时返回 null**（不返回空树——那会让 Cesium
 *          建出一个永远无内容的瓦片集，表现为「图层开着但什么都没有」）
 */
export function cropTileset(
  tileset: TilesetJson,
  baseUrl: string,
  options: DeriveOptions = {}
): TilesetJson | null {
  if (!tileset.root) return null
  const root = absolutizeNode(
    tileset.root,
    baseUrl,
    options.drop,
    options.keepSphere,
    options.dropContent
  )
  if (root === null || !hasAnyContent(root)) return null
  return { ...tileset, root }
}

/** 被 `dropContent` 摘空的节点中，最大的 geometricError（无则为 null） */
function maxDroppedGeometricError(
  node: TilesetNode,
  dropContent?: (node: TilesetNode) => boolean
): number | null {
  if (!dropContent) return null
  let best: number | null = null
  const walk = (n: TilesetNode) => {
    // 只看"被摘空且确实没有内容"的节点：这条判据在折叠前后都成立
    if (dropContent(n) && !n.content && typeof n.geometricError === 'number') {
      best = best === null ? n.geometricError : Math.max(best, n.geometricError)
    }
    for (const c of n.children ?? []) walk(c)
  }
  walk(node)
  return best
}

/** 折叠没有内容的中间层（子节点上提）；没有内容的叶子（画不出任何东西）直接丢弃 */
function collapseEmptyLevels(root: TilesetNode): TilesetNode {
  const fold = (node: TilesetNode): TilesetNode => {
    const kids = (node.children ?? []).map(fold)
    if (kids.length === 0) return { ...node }
    const flat: TilesetNode[] = []
    for (const k of kids) {
      if (k.content) {
        flat.push(k)
        continue
      }
      // 没内容：有子节点就把子节点提上来，没子节点就丢掉（它只会被选为空层）
      const grand = k.children ?? []
      if (grand.length > 0) flat.push(...grand)
    }
    return { ...node, children: flat }
  }
  return fold(root)
}

/**
 * 整包预处理：content.uri 全部绝对化并校正 geometricError——
 * 供「外部 http tileset → Data URI 挂载」的场景（不裁剪子树）。
 *
 * 与 deriveGroupTileset 的分工：后者按分组裁剪 root.children；本函数保留整棵树，
 * 只做 Data URI 挂载前必需的两件事（uri 绝对化，见模块头第 2 点；GE 校正，见上）。
 */
export function prepareTilesetForDataUri(tileset: TilesetJson, baseUrl: string): TilesetJson {
  const root = absolutizeNode(tileset.root, baseUrl)
  if (root === null) return tileset
  return normalizeTilesetGeometricError({ ...tileset, root })
}

/**
 * 裁剪 + GE 校正一步到位（Data URI 挂载前的完整预处理）。
 *
 * @returns 裁剪结果；剪空返回 null（调用方据此跳过注册并留痕，不要挂空瓦片集）
 */
export function cropTilesetForDataUri(
  tileset: TilesetJson,
  baseUrl: string,
  options: DeriveOptions = {}
): TilesetJson | null {
  const cropped = cropTileset(tileset, baseUrl, options)
  if (cropped === null) return null
  // ① 先按裁剪后的**完整树**校正 GE——空层的 GE 靠这一步才反映成品尺度
  //    （交付包原值 256/128/64/0 偏小 1~2 个数量级，直接拿来当上限会压过头）
  const normalized = normalizeTilesetGeometricError(cropped)
  const cap = options.capRootGeometricError
    ? maxDroppedGeometricError(normalized.root, options.dropContent)
    : null
  // ② 再折叠空层（子节点上提），最后压 root 的 GE——两步顺序不能反：
  //    先折叠就拿不到空层的 GE 了；先压后折叠则破坏 GE 单调性，实测遍历会停在 root。
  let out = normalized
  if (options.collapseEmptyLevels) {
    out = normalizeTilesetGeometricError({
      ...normalized,
      root: collapseEmptyLevels(normalized.root),
    })
  }
  if (cap !== null && cap > 0) {
    out.root.geometricError = Math.min(out.root.geometricError ?? Number.POSITIVE_INFINITY, cap)
  }
  return out
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

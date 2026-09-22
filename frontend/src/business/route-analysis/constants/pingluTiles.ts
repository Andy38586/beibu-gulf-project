/**
 * 平陆运河 3D Tiles 分组配置（**业务语义集中于此**）。
 *
 * ## 为什么分两组
 *
 * 瓦片集是一棵树：root 无 content，直属 20 个 child —— 3 个枢纽低模（各带分区子瓦片）
 * 与 17 个全线走廊块（14 个 corridor-* + 3 个 bridges-*）。Cesium 的 fromUrl 是整包
 * 加载，只能得到一个总开关，而「只看某枢纽」「只看桥」是实际诉求。
 *
 * 分组派生机制（裁子树 + uri 绝对化 + Data URI）与业务无关，放在 core
 * （`@/core` 的 tiles3dGroups）；**本文件只声明平陆运河自己的分组**：
 * 有哪些组、叫什么名、怎么判定。core 因此不含任何业务语义（04 清单 E5）。
 *
 * ## 判定为什么用 extras 而非 uri 前缀
 *
 * `extras.name` / `extras.kind` 是建模器写入的语义标注（build_tiles.py 产出），
 * 比文件名约定稳定——重命名即失效的判定会在下次重烘时静默漏块。
 * 唯一的例外是 bridges：它们与 corridor 块同为 `kind: 'corridor'`，
 * 无法用 kind 区分，故按 uri 前缀判定（见下方注释）。
 */

import { nodeName, nodeUri, type GroupSpec, type TilesetJson } from '@/core'

/**
 * 分组 id（图层 id 后缀，与注册时的 `pinglu-` + id 拼装一致）。
 *
 * 定义在此而非 core：这是本业务的图层命名约定。
 */
export type PingluGroupId = 'madao' | 'qishi' | 'qingnian' | 'bridges' | 'corridor'

/**
 * 平陆运河 3D Tiles 分组表。
 *
 * ⚠ **顺序即优先级**：`tallyGroups` 对一个 child 命中多组时计入首个。
 * bridges 必须在 corridor 之前——走廊组的谓词已显式排除 bridges-*，
 * 两道保险叠加，确保桥梁不会被走廊与桥梁两个图层重复渲染。
 * 枢纽按上游到下游排列，与图层面板的期望显示顺序一致。
 */
export const PINGLU_GROUPS: readonly GroupSpec<PingluGroupId>[] = [
  {
    id: 'madao',
    label: '马道枢纽',
    match: (c) => nodeName(c) === '马道枢纽',
  },
  {
    id: 'qishi',
    label: '企石枢纽',
    match: (c) => nodeName(c) === '企石枢纽',
  },
  {
    id: 'qingnian',
    label: '青年枢纽',
    match: (c) => nodeName(c) === '青年枢纽',
  },
  {
    id: 'bridges',
    label: '跨运河桥梁',
    // bridges-* 的 name 形如「全线走廊 · bridges-mid」——它们的 extras.kind 与
    // 普通走廊块相同，无法用 kind 区分，只能按 uri 前缀判定
    match: (c) => (nodeUri(c) ?? '').startsWith('bridges-'),
  },
  {
    id: 'corridor',
    label: '全线走廊',
    // 走廊 = kind 为 corridor 且**不属于** bridges 分组（否则桥梁会被双重渲染）
    match: (c) => c.extras?.kind === 'corridor' && !(nodeUri(c) ?? '').startsWith('bridges-'),
  },
] as const

/** 图层 id 前缀（图层面板 layer-order 与注册共用） */
export const PINGLU_LAYER_PREFIX = 'pinglu-'

/** 由分组 id 得到图层 id（如 'madao' → 'pinglu-madao'） */
export function pingluLayerId(groupId: PingluGroupId): string {
  return PINGLU_LAYER_PREFIX + groupId
}

/**
 * 瓦片集地址。
 *
 * 由后端 static 托管（dev 走 vite /static 代理、prod 走 nginx alias），与 dem/terrain
 * 同一通道；落位坐标由模型自带的逐顶点椭球曲率烘焙决定（tileset.root.transform），
 * 前端只负责挂载与显隐，**不做任何坐标纠偏**。
 */
export const PINGLU_TILESET_URL = '/static/pinglu/tiles/tileset.json'

/** 离线影像索引地址（z=17 拼接图 + bbox，每块一个可开关图层） */
export const PINGLU_IMAGERY_INDEX_URL = '/static/pinglu/imagery/imagery.json'

/** 影像块图层 id 前缀 */
export const PINGLU_IMAGERY_LAYER_PREFIX = 'pinglu-imagery-'

/** 影像索引条目（imagery.json 的元素结构） */
export interface PingluImageryEntry {
  name: string
  label: string
  file: string
  width: number
  height: number
  /** [west, south, east, north]，EPSG:4326 */
  bbox: [number, number, number, number]
}

/** imagery.json 顶层结构 */
export interface PingluImageryIndex {
  tiles: PingluImageryEntry[]
}

/** 收敛类型（供页面标注 fetch 结果，避免就地写匿名类型） */
export type { GroupSpec, TilesetJson }

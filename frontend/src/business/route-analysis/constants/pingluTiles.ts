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
 * 2026-10-03：corridor 与 bridges 两个分组**均已作废**（判据见文件末成文段），
 * 表里只剩三枢纽。运河与桥梁改由 tools/3dtiles-build 重烘后单独成层。
 */

import { nodeName, type DeriveOptions, type GroupSpec, type TilesetJson } from '@/core'

/**
 * 分组 id（图层 id 后缀，与注册时的 `pinglu-` + id 拼装一致）。
 *
 * 定义在此而非 core：这是本业务的图层命名约定。
 */
export type PingluGroupId = 'madao' | 'qishi' | 'qingnian'

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
] as const

/**
 * ## 2026-10-03 废弃：`corridor` 分组（全线走廊 11 块）
 *
 * 原 `corridor` 分组承担 11 个 `corridor-*` 块。**实测它们本来就是断的**：
 * 块间接缝最大 6245 m（最近顶点距离，本机实测）。而三枢纽按施工影像重锚后，
 * 马道枢纽偏离运河中线 248 m——**走廊到枢纽角就断了**，渲染图上肉眼可见
 * （.local/3d-diag/out-madao-diag.png）。
 *
 * 逐块平移解决不了：交付包把运河切成 11 段，各段位移不同，平移只是把断点挪位置。
 *
 * 现由 `tools/3dtiles-build/build-canal.mjs` 从 OSM 中线**重烘成一条连续带**
 * （水面 120 m + 两岸各 60 m），并按三个枢纽做局部扭曲使其穿过枢纽。
 * 层见 `beibu3dTiles` 的 `pinglu-canal`。
 *
 * 11 块 corridor 与 3 块 bridges **不再归属任何分组**，派生时自然丢弃——
 * 保留它们就是同一位置两套互相穿插的模型。
 *
 * **失效条件**：若交付包重新交付并给出**连续**的运河几何（块间接缝 ≤ 20 m），
 * 本条作废，须重新评估留交付版还是留自建版。
 */

/**
 * ## 2026-10-03 废弃：`bridges` 分组（跨运河桥梁）
 *
 * 原 `bridges` 分组把交付包里的 `bridges-up` / `bridges-mid` / `bridges-urban`
 * 三块当成桥显示。**实测它们不是桥**——是半轴 12×13 km / 6×13 km / 1.5×4.9 km 的
 * **走廊条**（见 .local/3d-diag/bridges.cjs）。用户原话：「钦州新建的几座桥，位置没
 * 对齐，而且桥也不行，桥也得单独建模」。
 *
 * 现由 `tools/3dtiles-build/build-bridges.mjs` 生成的城区五桥层承担
 * （`beibu3dTiles` 的 `qz-city-bridges`）。三块 corridor 条**不再归属任何分组**，
 * 派生时自然被丢弃——保留它们就是同一位置两套互相穿插的模型。
 *
 * **失效条件**：若 `backend/static/pinglu/tiles/tileset.json` 重新交付并把这
 * 三块换成真桥几何，本条作废，须重新评估是留交付版还是留自建版。
 */

/**
 * 派生时剔除的瓦片：交付包给每个枢纽配的「地形与边坡」层
 * （`extras.name` = 「马道枢纽 · 地形与边坡」等，文件 `*-z1-terrain.glb`）。
 *
 * 它是交付方用 **Copernicus DEM** 生成的**局部地表**；而本项目的真地形来自
 * **CTB**（ASTER GDEM 派生 + 海陆掩膜）。两套 DEM 不同源，高程必然不一致——
 * 2026-09-28 项目内实测：同时开启时表现为一块**斜插进地形的平板**，侧视能看到
 * 硬直的交接线与互相穿插，三个枢纽全中。
 *
 * 剔除它，闸室 / 闸门 / 引航道等**构筑物**便落回项目地形：**地形归地形，
 * 构筑物归构筑物**，渲染层不再叠两层地表。
 *
 * 判定用 `extras.name` 而非 uri 前缀——与分组配置同一口径，改文件名不会静默失效。
 */
const PINGLU_DROPPED_LABEL = '地形与边坡'

/** 派生选项：剔除枢纽自带的「地形与边坡」层（理由见上） */
export const PINGLU_DERIVE_OPTIONS: DeriveOptions = {
  drop: (node) => (nodeName(node) ?? '').includes(PINGLU_DROPPED_LABEL),
}

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
 *
 * 2026-09-28：`tiles/` 已换成交付包的**增强版瓦片**（带贴图/UV），旧版（9/27 白模落位版）
 * 备份在 `.local/tmp/pinglu-tiles-backup-20260928/`。切换方式是把交付包的 30 个 GLB
 * 覆盖进来 + 补回交付包漏掉的 `corridor-10`（其 README 自称已补回，实物没有）——
 * 不补就会踩 `tiles3d-check` 的覆盖事故指纹（内容节点 30 < 下限 31）。
 * `tiles-v2`（9/16 s3 管线的 63 瓦片版）仍在仓库，未被本处引用。
 */
export const PINGLU_TILESET_URL = '/static/pinglu/tiles/tileset.json'

/**
 * ## 2026-10-03 废弃成文：`pinglu/tiles-v2`（**读侧不消费，但仍在盘上**）
 *
 * 用户裁定原文：「我好像带回来两套，以最后那一套为准」。实测两套是：
 *
 * | 目录 | 体积 | 内容 | 状态 |
 * | --- | --- | --- | --- |
 * | `pinglu/tiles` | 12.1 MB | 3 枢纽 + 3 桥梁 + 11 走廊，17 个 root child | **权威源**（本常量指向它） |
 * | `pinglu/tiles-v2` | 43.5 MB | 57 条「全线地形」+ 3 枢纽 + 桥梁 + 运河水面 + 钦州湾海面，63 个 child | **废弃** |
 *
 * 判定「最后那套」的两条依据：① `tiles` 改于 2026-09-28 20:08，`tiles-v2` 改于
 * 2026-09-27 21:29；② 最后那套**一并带来了钦州港瓦片**（`backend/static/qinzhou-port/`），
 * 与用户描述吻合。
 *
 * 另：`tiles-v2` 里**没有钦州港内容**（关键词 qinzhou/port/terminal/cargo/container
 * 命中均为 0），只有「钦州湾海面」一块 2.23 MB 的 b3dm。
 *
 * **读侧仍有 2 处指向它，都是遗留物**（不是活消费）：
 * - `frontend/public/probe-3dtiles.html:88,153,182` —— 调试页，硬编码 tiles-v2 路径
 * - `frontend/public/madao-hub.json:29` —— 从 tiles-v2 派生的单枢纽预览件
 *
 * **失效条件**：若日后有人把 `tiles-v2` 当权威源读回去（最可能通过那个调试页），
 * 本条作废的前提不成立，须先删掉那两处指向再谈。
 *
 * 盘上 43.5 MB 是否删除由用户定（删资产属破坏性操作，不自行决定）；本条只声明
 * **读侧不消费**，并留一条能红的判据：下面的断言钉死 `PINGLU_TILESET_URL` 不得
 * 指向 tiles-v2。
 */

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

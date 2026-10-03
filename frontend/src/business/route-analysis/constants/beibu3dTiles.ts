/**
 * 北部湾 3D Tiles 资产清单（**业务语义集中于此**）。
 *
 * ## 资产来源
 *
 * 2026-09-28 第三方交付包（`传输包-20260928`）中的两套独立瓦片集，均落在后端
 * `backend/static/` 下走 `/static` 通道（dev 走 vite 代理、prod 走 nginx alias，
 * 与 terrain/dem/pinglu 同一口径）：
 *
 * | id | 来源 | 内容 |
 * | --- | --- | --- |
 * | `qinzhou-port` | `01_钦州港3DTiles/tiles/` | 96 瓦片 / 381 万三角面 / **自带地形层** |
 * | `qz-terminal-bim` | `04_BIM转3DTiles/qinzhou-port-terminal/` | 5 构件组 / **纯构筑物，无地表** |
 *
 * ## 为什么这两条要并排放
 *
 * 它们回答的是同一个问题的两侧：**项目 CTB 真地形（`/static/terrain/`）能否与
 * 3D Tiles 共存**。判据不在「能不能渲染」，而在瓦片内容里**有没有地表**：
 *
 * - `qinzhou-port` 的 t0~t3 层是 REPLACE 地形网格（面/顶点比 ≈ 1.95 的规则格网，
 *   实测 Z 跨度 7.17 m / XY 跨度 1617×1855 m）⇒ 与 CTB 地形叠加即**两层地表**；
 * - `qz-terminal-bim` 只有 IFC 构件，无地表 ⇒ 与地形叠加不产生「双层地形」，
 *   剩下的只是锚点高程基准差（椭球高 vs 正高）。
 *
 * ## 2026-10-03 废弃：三条平陆运河 BIM 枢纽（**读侧不再消费**）
 *
 * 原 `bim-madao` / `bim-qishi` / `bim-qingnian` 三条**已从本清单移除**。判据：
 *
 * - 它们与 `pinglu-madao` / `pinglu-qishi` / `pinglu-qingnian`（07 交付版）
 *   **是同一枢纽的两套模型**：局部包围盒中心与半轴逐位相同（马道 中心(180,162.5)
 *   半轴(1000,472.5)；企石 (180,96)/(1000,386)；青年 (180,84.5)/(1020,498.5)），
 *   世界锚点仅差 ~200 m ⇒ 默认全开时同一位置渲染两套互相穿插的模型。
 * - 留 07 交付版的三条硬理由：①已入库且受 `tiles3d-check` 守护；②有分区 LOD
 *   （低模 → 5 分区，<1.5 km 替换），BIM 版是 9 个叶子 `GE=0` 一次全下；
 *   ③与走廊同一交付包、同一根变换（接缝 0.00 m），BIM 版是另一个交付包。
 * - **失效条件**：若日后重新引入 `backend/static/bim-hub/pinglu-*-hub/`，
 *   必须同时移除对应的 `pinglu-*` 分组，否则「两套同开」立即复现。
 */

import {
  cropTilesetForDataUri,
  prepareTilesetForDataUri,
  type CropSphere,
  type DeriveOptions,
  type TilesetJson,
  type TilesetNode,
} from '@/core/map/tiles3dGroups'

/** 资产 id（图层 id 后缀，与注册时的 `beibu-` + id 拼装一致） */
export type BeibuTilesId =
  | 'pinglu-canal'
  | 'qinzhou-port'
  | 'qz-containers'
  | 'qz-roads'
  | 'qz-city-bridges'
  | 'qz-terminal-bim'

export interface BeibuTilesSpec {
  id: BeibuTilesId
  /** 图层面板显示名 */
  label: string
  /** tileset.json 地址（后端 static 托管） */
  url: string
  /**
   * 派生选项（可选）。**给了就走 `cropTilesetForDataUri`，不给走 `prepareTilesetForDataUri`**。
   *
   * 为什么放在清单里而不是注册点：与 `defaultVisible` / `maximumScreenSpaceError` 同款
   * 取舍——"这个资产要不要裁、裁到哪"是数据，不是流程；写在条目自己身上，下一个人
   * 一眼能看出哪几条被裁过、判据是什么。
   */
  derive?: DeriveOptions
  /**
   * **该资产是否自带地表网格**。
   *
   * 这不是描述性注释，而是共存判据的数据化：`true` 表示该 tileset 的 REPLACE 层
   * 已经是完整地表，与 CTB 地形同时开启必然出现两层地面（模型地表 vs CTB 地表，
   * 两者来自不同 DEM 数据源，高程不可能一致），消费方据此决定是否需要隐藏 globe
   * 或只保留 ADD 层地物。判据写入清单而非散落在调用点，避免"下一个人不知道
   * 这块瓦片带不带地形"。
   */
  carriesTerrain: boolean
  /**
   * 该资产的最大屏误差（像素）。
   *
   * 只出这一个参数：`Tiles3DOptions` 目前仅声明 `maximumScreenSpaceError`，
   * 而 adapter 的 create 分支也只透传这一个字段（`layerAdapters` 的 `tilesOptions`），
   * 写 `skipLevelOfDetail` / `loadSiblings` 之类既过不了类型、也不会生效——
   * 要放宽 LOD 行为得先扩 `Tiles3DOptions` 契约，属单独一笔改动。
   */
  maximumScreenSpaceError: number
  /**
   * 注册进图层面板时是否默认可见。
   *
   * 由清单声明而不是散在页面里：本组资产体积差三个数量级（4.7 MB ~ 345 MB），
   * "默认开哪几个"是取舍，取舍要看得见——写在每个条目自己身上，
   * 下一个人一眼能看出代价分布。
   */
  defaultVisible: boolean
}

/**
 * 按清单条目预处理原始 tileset，产出可直接编 Data URI 的结果。
 *
 * **注册点必须直调本函数，不要在两处各写一遍分支**——「哪条走裁剪、哪条走整包」
 * 是清单的数据（`spec.derive`），把它实现成函数是为了让这条分支有**行为判据**：
 * 单测拿真实条目直调本函数，删掉裁剪分支即红（源码子串断言被 04-F 禁止，
 * 判据必须落在行为上）。
 *
 * @returns 预处理结果；裁剪后无内容时返回 null（调用方据此跳过注册，不挂空瓦片集）
 */
export function prepareBeibuTileset(raw: TilesetJson, spec: BeibuTilesSpec): TilesetJson | null {
  return spec.derive
    ? cropTilesetForDataUri(raw, spec.url, spec.derive)
    : prepareTilesetForDataUri(raw, spec.url)
}

/** 图层 id 前缀（图层面板 layer-order 与注册共用） */
export const BEIBU_TILES_LAYER_PREFIX = 'beibu-'

/** 由资产 id 得到图层 id（如 'qinzhou-port' → 'beibu-qinzhou-port'） */
export function beibuTilesLayerId(id: BeibuTilesId): string {
  return BEIBU_TILES_LAYER_PREFIX + id
}

/**
 * 资产表。**钦州港两套瓦片都在这**（2026-09-28 传输包 01 + 04 两个目录）。
 *
 * `maximumScreenSpaceError` 刻意区分：钦州港单块细瓦片可达 13 MB、整包 144 MB，
 * 取 32（放宽屏幕误差）压请求量；码头 BIM 构件总量小，取 16 保住构件细节。
 *
 * `defaultVisible` 全为 `true`：用户要"带回来的全部加载起来"，第一眼就要看到。
 * 体积代价不再由首屏承担——3D Tiles 挂在**懒加载路由**（RouteAnalysisPage）上，
 * 且预取进 `warmupAfterFirstFrame` 预热队列，面板里可逐条关掉。
 */
/**
 * 钦州港**作业区**裁剪球（tileset 局部 ENU 系，单位米）。
 *
 * ## 怎么来的
 *
 * 交付包覆盖 16×18 km，root 是唯一带 `transform` 的节点（96 个节点里仅 1 个），
 * 子节点包围盒一律是**局部系轴对齐盒**，故局部系即「以 root 原点为原点的 ENU」。
 * 中心取交付包 `catalog.json` 的 `harbour` 条目（钦州保税港区 108.6473/21.6745），
 * 经 root.transform 的旋转逆变换得局部 (1014.26, 2159.18, −0.45)。
 *
 * ## 半径 1500 m 的依据（2026-10-03 逐瓦片实测）
 *
 * | 层 | 块数 | 材质 | 处置 |
 * | --- | --- | --- | --- |
 * | d0~d3 | 85 | 全部 `water/opaque`（30.3 M m² 水面与地形） | 球外剔除 / 球内摘内容 |
 * | d4~d5 | 7 | `cargo` 集装箱 / `metal` 龙门架 / `concrete` / `rail` / `roof` | 保留 |
 *
 * 球内 7 块的最近 6 块距中心 286~1063 m，合计 23.2 MB（整包 143.5 MB）——
 * 这就是用户要的「作业区」。半径放大到 2500 m 会把球外 5 块无关地物拉进来。
 *
 * **失效条件**：交付包更换或 root.transform 变化时中心须按同一算法重算；
 * 判据是「裁剪后保留的瓦片里必须出现 cargo 或 metal 材质」。
 */
export const QINZHOU_OPERATION_AREA: CropSphere = {
  center: [1014.26, 2159.18, -0.45],
  radius: 1500,
}

/** 钦州港交付包里「自带粗层地表」的最大深度（含） */
export const QINZHOU_COARSE_MAX_DEPTH = 3

/**
 * 是否为交付包自带的**粗层地表**节点（钦州港 d0~d3）。
 *
 * 判据用 `extras.depth` 而不是材质名：材质要解 GLB 才能读到，而 depth 是建模器
 * 直接写在 extras 里的结构化字段（`tiles3dGroups` 的 `nodeName` 同款思路）。
 *
 * 为什么必须**只摘内容、不删节点**：这些粗层节点是精细子瓦片的唯一通路，
 * 节点一删，其下 d4/d5 的集装箱/龙门架跟着整棵消失（`dropContent` 的语义，
 * 与 `drop` 的连子树删相反）。理由与平陆运河剔 `*-z1-terrain` 一致：
 * 自带地表与项目 CTB 地形不同源，同开即两层地面；地形归地形、地物归地物。
 *
 * **失效条件**：交付包若把地物下沉到 d3 或把地表上抬到 d4，本判据立即失效——
 * 判据是「裁剪后保留的瓦片里必须出现 cargo 或 metal 材质」。
 */
export function isCoarseTerrainLayer(node: TilesetNode): boolean {
  const d = node.extras?.depth
  return typeof d === 'number' && d <= QINZHOU_COARSE_MAX_DEPTH
}

export const BEIBU_TILES: readonly BeibuTilesSpec[] = [
  {
    id: 'pinglu-canal',
    // 由 tools/3dtiles-build/build-canal.mjs 从 OSM 中线**重烘成一条连续带**：
    // 水面 120 m + 两岸各 60 m，并按三个枢纽做局部扭曲使其穿过枢纽。
    // 替代交付包那 11 块 corridor-*——实测它们块间接缝最大 6245 m，本来就是断的，
    // 而枢纽按施工影像重锚后马道偏离中线 248 m，走廊到枢纽角就断了。
    // ⚠ 断面为参数化取值（底宽 80 m + 边坡估算），非量测。
    label: '平陆运河 · 全线运河（重建）',
    url: '/static/pinglu/canal/tileset.json',
    carriesTerrain: false,
    maximumScreenSpaceError: 32,
    defaultVisible: true,
  },
  {
    id: 'qinzhou-port',
    // 指向**清空版**：原包的 cargo 集装箱棱柱已被 tools/3dtiles-build/clean-cargo.mjs
    // 摘掉，集装箱改由 qz-containers 层供应。不摘就是同一位置两套互相穿插的模型
    // —— 本项目已踩过一次（三条 BIM 枢纽，见文件头）。
    label: '钦州港 · 作业区三维',
    url: '/static/qinzhou-port/rebuilt/tileset.cleaned.json',
    carriesTerrain: true,
    maximumScreenSpaceError: 32,
    defaultVisible: true,
    // 裁到作业区：球外整棵剔除，球内粗层摘内容（见 QINZHOU_OPERATION_AREA 的实测表）
    derive: {
      keepSphere: QINZHOU_OPERATION_AREA,
      dropContent: isCoarseTerrainLayer,
    },
  },
  {
    id: 'qz-containers',
    // 由 tools/3dtiles-build/rebuild-containers.mjs 生成：8180 个箱区 → 79622 个
    // 集装箱实例，5 款箱型（ISO 668），按 EXT_mesh_gpu_instancing 实例化。
    // 整层 0.8 MB（逐实例展开顶点则是 178.3 MB）。
    label: '钦州港 · 集装箱（重建）',
    url: '/static/qinzhou-port/rebuilt/tileset.json',
    carriesTerrain: false,
    maximumScreenSpaceError: 16,
    defaultVisible: true,
  },
  {
    id: 'qz-roads',
    // 由 tools/3dtiles-build/build-roads.mjs 生成：OSM 92 条 highway 中心线 → 挤出路面，
    // 按等级取宽（secondary 12 / tertiary 9 / unclassified 7 / service 5 m）。
    // 高程取交付包箱区底面（局部 u=-20.35 m），不是 0——u=0 是 root 原点高度不是地面。
    label: '钦州港 · 作业区道路',
    url: '/static/qinzhou-port/rebuilt/roads/tileset.json',
    carriesTerrain: false,
    maximumScreenSpaceError: 16,
    defaultVisible: true,
  },
  {
    id: 'qz-city-bridges',
    // 由 tools/3dtiles-build/build-bridges.mjs 生成：城区 5 座跨江桥（金海湾/钦江/
    // 子材/永福/敏昌），桥位与长度取自 OSM，桥型与跨径来自公开资料。
    // 替代交付包里那三块「走廊条」——实测它们半轴 12×13 km，根本不是桥。
    // ⚠ 属**参数化还原**，非实测几何（见 tileset 各节点 extras.reconstruction）。
    label: '钦州城区 · 跨江桥（重建）',
    url: '/static/bridges-city/tileset.json',
    carriesTerrain: false,
    maximumScreenSpaceError: 16,
    defaultVisible: true,
  },
  {
    id: 'qz-terminal-bim',
    label: '钦州港 · 码头 BIM 构件',
    url: '/static/bim-hub/qinzhou-port-terminal/tileset.json',
    carriesTerrain: false,
    maximumScreenSpaceError: 16,
    defaultVisible: true,
  },
] as const

/**
 * 各资产的观察落点（经纬高，供「飞到」使用）。
 *
 * 高为**椭球高**：Cesium 相机 destination 用的就是这个基准，取的高度只是俯视高度，
 * 与资产自身的地面高程无关，不做大地水准面改正。
 *
 * 经纬取各资产的实际上线位置：钦州港取自交付包 `catalog.json` 的 `harbour` 条目
 * （钦州保税港区 108.647304 / 21.674497）。
 */
export const BEIBU_TILES_VIEWS: Record<BeibuTilesId, { lng: number; lat: number; height: number }> =
  {
    'pinglu-canal': { lng: 108.93696, lat: 22.44918, height: 20000 },
    'qinzhou-port': { lng: 108.6473, lat: 21.6745, height: 6000 },
    'qz-containers': { lng: 108.6473, lat: 21.6745, height: 1800 },
    'qz-roads': { lng: 108.6473, lat: 21.6745, height: 3000 },
    'qz-city-bridges': { lng: 108.63504, lat: 21.9689, height: 2500 },
    'qz-terminal-bim': { lng: 108.6473, lat: 21.6745, height: 1800 },
  }

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
 * - **失效条件**：若日后重新引入 `backend/static/bim-hub/pinglu-*-hub/`（盘上副本已于
 *   2026-10-09 随减重计划批 2 单元 8 删除，复取即属重新引入），必须同时移除对应的
 *   `pinglu-*` 分组，否则「两套同开」立即复现。
 *
 * ## 2026-10-03 废弃：`qz-terminal-bim`（码头 BIM 构件，**读侧不再消费**）
 *
 * 用户在页面上指出「港口的也没对上」。实测根因不是"没对上"，是**这套构件本身坏了**：
 *
 * | 构件 | 体积 | 局部包围盒半轴 | 到作业区中心 |
 * | --- | --- | --- | --- |
 * | `ifcbuildingelementproxy` | **167.4 MB** | **4868 m** | 864 m |
 * | `ifcslab` | 15.8 MB | 4795 m | 892 m |
 * | `ifctransportelement` | 14.8 MB | 4819 m | 970 m |
 * | `ifcwall` | 1.9 MB | 4668 m | 1005 m |
 * | `ifclightfixture` | 0.7 MB | 4667 m | 837 m |
 *
 * 半轴 4.8 km ⇒ 每个构件都是 **~10 km 见方的巨板**（IFC→3D Tiles 转换把场地级
 * 图元当成了建筑构件），渲染出来就是覆盖整个港区的一块深色板，上面带着圆孔
 * （桩基/罐体的俯视投影）。这不是"位置没对齐"，是资产不可用。
 *
 * 三条独立的废弃理由，任一条都足够：
 * ① 几何不可用（10 km 板 vs 实际建筑构件）；
 * ② 体积超标——单图层 200.7 MB，远超「单图层 ≤ 30 MB」；
 * ③ 无 LOD——5 个叶子全 `GE=0`，一次全下。
 *
 * **失效条件**：若 `backend/static/bim-hub/qinzhou-port-terminal/` 重新导出为
 * 真实构件尺度（半轴 ≤ 100 m）且总体积 ≤ 30 MB，本条作废，可重新评估引入。
 */

import {
  cropTilesetForDataUri,
  prepareTilesetForDataUri,
  type CropSphere,
  type DeriveOptions,
  type TilesetJson,
  type TilesetNode,
} from '@/core/map/tiles3dGroups'

import { LOD_REFINE_GE_PER_SSE } from './lodRefinePolicy'

/** 资产 id（图层 id 后缀，与注册时的 `beibu-` + id 拼装一致） */
type BeibuTilesId =
  | 'pinglu-canal'
  | 'qinzhou-port'
  | 'qz-containers'
  | 'qz-roads'
  | 'qz-ground'
  | 'qz-city-bridges'

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
const BEIBU_TILES_LAYER_PREFIX = 'beibu-'

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

/**
 * 交付包**根节点**（depth 0）的粗层**保留内容**——它是远景唯一可见的"主体壳"。
 *
 * ## 为什么不能连 root 一起摘（2026-10-04 运行时阶梯实测）
 *
 * `.local/3d-review/lod-ladder.cjs` 在 300 m / 1.5 km / 6 / 20 / 30 / 40 / 60 / 80 / 586 km
 * 九个高度、四个资产上逐档读 `_selectedTiles`：三枢纽 6/6 档全在场，而**钦州港作业区
 * 只在 300 m~60 km 在场，80 km 与 586 km（= 打开页面时的默认全域视角）整层空白**——
 * 因为粗层内容被摘掉，远景只剩"选了但没内容"的节点，用户的"LOD 不统一"就是这个。
 *
 * 保留 root 的代价是 `t0_0_0.glb` **1.9 MB**（实测材质：water 26456 / opaque 9493 /
 * **metal 6440** / concrete 158 面 ⇒ 是带龙门架的水陆主体，不只是地形片）。
 * 近景不受影响：REPLACE 语义下精细子瓦片被选中即**替换**父内容，不会出现两层地面
 * （实测 300 m~60 km 仍由 d4/d5 承担，`sel=7 tri=458283` 不变）。
 *
 * **失效条件**：① 交付包换版若把 depth 0 的内容换成纯地形片（无 metal），则本条作废，
 * 需改为自建远景壳；② 若 60~80 km 之间出现"壳与精细层同时可见"的重叠，说明 REPLACE
 * 语义在该树未生效，须重新裁决保留层级。
 */
export function shouldDropPortContent(node: TilesetNode): boolean {
  // root（depth 0）**不摘**：它是远景唯一带结构的主体粗模（t0_0_0.glb，1.9 MB，
  // 实测材质 water 26456 / opaque 9493 / metal 6440 / concrete 158 面）。d1~d3 摘内容，
  // 由 capRootGeometricError 保证这些空层永远不会成为遍历终点（见 core 的同名注释）。
  const d = node.extras?.depth
  return typeof d === 'number' && d > 0 && d <= QINZHOU_COARSE_MAX_DEPTH
}

/** 港区图层配置的屏误差（像素）——清单条目与下方下限推导共用同一来源 */
const QINZHOU_MAX_SSE = 32

/**
 * 港区远景壳守卫距离（米）：默认机位的 **2 倍**——拉远一倍仍不得整层空白。
 *
 * 默认机位 585,937 m 为页面首屏实测（`zoom 9 → 300e6/2^9`，2026-10-04 探针），取整 586 km。
 */
export const QINZHOU_SHELL_GUARD_DISTANCE = 2 * 586_000

/** 推导用最小画布高（px）：探针最窄档 900 px 宽实测 605 px 高，取整留余 */
const QINZHOU_MIN_CANVAS_HEIGHT_PX = 600

/** 闸门判据是 `<=`（等号即整层消失），推导留 25% 余量 */
const QINZHOU_GATE_MARGIN = 1.25

/** Cesium 60° FOV 在纵横比 ≤1 时按竖直解析 ⇒ sseDenominator 上界 2·tan30°（最坏情形） */
const SSE_DENOMINATOR_MAX_60DEG = 2 * Math.tan(Math.PI / 6)

/**
 * 港区图层**顶层 `geometricError` 下限（米）**——让远景壳跨视口宽高统一在场。
 *
 * ## 机制（2026-10-04 运行时实测 + Cesium 源码）
 *
 * `Cesium3DTilesetBaseTraversal.selectTiles` 访问 root 前有一条早退：
 * `root.getScreenSpaceError(frameState, true) <= memoryAdjustedScreenSpaceError` 即 `return`
 * （`visited = 0`，root 自己的内容也不选）。root 无 parent ⇒ 该 SSE 的 GE 取的是
 * **顶层 `geometricError`**（`Cesium3DTile` 的 `tileset._scaledGeometricError` 分支），
 * 而不是被 `capRootGeometricError` 压过的 root 瓦片 GE。故整层被剔除的距离
 * `d_cull = GE_top · H / (maxSSE · sseDenominator)`（H = 画布高）。
 *
 * 实测（586 km 默认机位、交付包现顶层值 18045.7、maxSSE 32）：1440/1280 px 出壳
 * （H=968/860 ⇒ 闸门 SSE 38.4/34.1 > 32），1180 px 及以下整层空白（H=793 ⇒ 31.5 ≤ 32）。
 * 即「同一机位，视口高的差别把闸门推过阈值」——用户看到的「LOD 不统一」。
 * 本项只抬整层早退的距离，不动 root GE ⇒ 精细层出现距离（LOD 切换）不变：
 * 900 px 档闸门 SSE 从 24.0 抬到 120.0，而 60 km 仍是 7 块 / 458283 tri（运行时对照实测）。
 *
 * ## 取值（不手抄常数，按守卫推导）
 *
 * 要求：画布高 ≥ 600 px、相机距锚点 ≤ {@link QINZHOU_SHELL_GUARD_DISTANCE} 时闸门不得触发。
 * sseDenominator 取上界（纵横比 ≤1 时 60° FOV 按竖直 ⇒ 2·tan30°；纵横比越大分母越小）。
 *
 * **失效条件**：① 清单的 maxSSE / 默认机位 / 最小画布高任一变更 ⇒ 本值须按同式重算
 * （`tools/diag/probe-port-far-view-vs-viewport.cjs` 会先红）；② 相机拉远超过
 * ~1.5 Mm（最坏纵横比）~2.2 Mm（常用 1.49 纵横比）后整层仍会被 Cesium 剔除——
 * 这是「整层太小不值得画」的固有行为，要到那个量级须再抬下限。
 */
export const QINZHOU_TOP_GE_FLOOR =
  (QINZHOU_MAX_SSE *
    QINZHOU_GATE_MARGIN *
    QINZHOU_SHELL_GUARD_DISTANCE *
    SSE_DENOMINATOR_MAX_60DEG) /
  QINZHOU_MIN_CANVAS_HEIGHT_PX

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
    // 2026-10-03 晚改回**交付包原版**（用户指出「传输包-20260928 里有完整的 3DTiles」）。
    // 实测同机位对照（.local/3d-review/sheet-delivered-cmp.png）：交付包的 cargo 是**有颜色、
    // 有体积的集装箱堆场**；我们参数化重建的那层在同机位下是**一层扁平米色片**。
    // 故原版为准，参数化重建降级为可手动打开的备选（defaultVisible:false）。
    // 仍走 derive：球外剔除 + 粗层（depth≤3）摘内容——那层是交付包自带的 REPLACE 地表，
    // 与 CTB 地形不同源，同开即两层地面（见 QINZHOU_OPERATION_AREA 的实测表）。
    label: '钦州港 · 作业区三维（交付包）',
    url: '/static/qinzhou-port/tiles/tileset.json',
    carriesTerrain: true,
    maximumScreenSpaceError: QINZHOU_MAX_SSE,
    defaultVisible: true,
    // 裁到作业区：球外整棵剔除，球内粗层摘内容（见 QINZHOU_OPERATION_AREA 的实测表）
    derive: {
      keepSphere: QINZHOU_OPERATION_AREA,
      dropContent: shouldDropPortContent,
      // 光摘内容不够：遍历会在"空层"上停下来 ⇒ 远景（80 km / 586 km 默认视角）整层空白。
      // 折叠空层后：远距离的终点落在**有内容的 root**（远景壳）上，近距离才细化到 d4/d5。
      // 细化距离不按数据自派生（capRootGeometricError 会给出 8558 ⇒ 比三枢纽远 2.14×），
      // 而是用统一口径 K × maxSSE —— 与三枢纽同一相机距离切换粗精（见 LOD_REFINE_GE_PER_SSE）。
      refineGeometricError: LOD_REFINE_GE_PER_SSE * QINZHOU_MAX_SSE,
      collapseEmptyLevels: true,
      // 压 root GE 后还有第二道闸门：Cesium 访问 root **之前**按顶层 geometricError
      // 判「整层太小就先 return」（见 QINZHOU_TOP_GE_FLOOR 的机制注释与实测）。
      // 现状 18045.7 在 586 km 默认机位下 1180 px 及以下窗口整层空白——远景壳
      // 随视口高翻转；抬到守卫下限后 6 档视口宽度统一在场（探针 6/6 绿）。
      topGeometricErrorFloor: QINZHOU_TOP_GE_FLOOR,
    },
  },
  {
    id: 'qz-containers',
    // 由 tools/3dtiles-build/rebuild-containers.mjs 生成：箱区 → 集装箱实例（5 款箱型，
    // ISO 668），按 EXT_mesh_gpu_instancing 实例化。实例数/体积随数据与水面裁剪变化，
    // 权威读数=重建脚本 stdout（不复述数字，防未受控产物计数腐烂）。
    // 2026-10-03：默认关闭。交付包原版已带 cargo（见上条），两层同开会互相穿插；
    // 留着重在"万一原版又出问题时有备选"，打开需手动勾选。
    label: '钦州港 · 集装箱（重建，备选）',
    url: '/static/qinzhou-port/rebuilt/tileset.json',
    carriesTerrain: false,
    maximumScreenSpaceError: 16,
    defaultVisible: false,
  },
  {
    id: 'qz-roads',
    // 由 tools/3dtiles-build/build-roads.mjs 生成：OSM 92 条 highway 中心线 → 挤出路面，
    // 按等级取宽（secondary 12 / tertiary 9 / unclassified 7 / service 5 m）。
    // 高程由 build-roads.groundLevel() 从**交付包几何**派生（rail/concrete 中位 ≈ −15.5 m），
    // 不再取"箱区盒底"——那个值来自空间分桶的包围盒，实测比真实场地低 4.7 m，
    // 导致路网整层埋在交付包表面之下（用户：「路不平，有缝隙」）。2026-10-04 已修。
    // 交付包里**没有 road 材质**，作业区路网靠本层补，故保持默认打开。
    label: '钦州港 · 作业区道路（OSM 挤出）',
    url: '/static/qinzhou-port/rebuilt/roads/tileset.json',
    carriesTerrain: false,
    maximumScreenSpaceError: 16,
    defaultVisible: true,
  },
  {
    id: 'qz-ground',
    // 由 tools/3dtiles-build/build-ground.mjs 生成：按施工影像的**陆域掩膜**把路与路之间
    // 的空地铺满（逐格判四角 + 中心，任一点落水即不铺），高程 = 箱区底面 + 0.05 m，
    // 比路面低 10 cm。为什么需要：道路层只画路面（5~12 m 宽的带），路网之间的空地露的是
    // 底图影像 ⇒ 用户看到的「港区根本不连续、路之间的缝隙太大」。
    // 2026-10-04：**默认关闭**。它是"没有交付包时"的补丁；交付包原版已自带码头面，
    // 这块 35240 面的均匀平板反而把交付包的精细面盖住（同机位 A/B：
    // .local/3d-review/sheet-roads-ab.png 左=开/右=关，右边才是完整港口）。
    label: '钦州港 · 作业区地面（补丁，备选）',
    url: '/static/qinzhou-port/rebuilt/ground/tileset.json',
    carriesTerrain: false,
    maximumScreenSpaceError: 16,
    defaultVisible: false,
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
] as const

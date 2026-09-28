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
 * | `bim-madao` | `04_BIM转3DTiles/pinglu-madao-hub/` | 9 构件组 / **纯构筑物，无地表** |
 *
 * ## 为什么这两条要并排放
 *
 * 它们回答的是同一个问题的两侧：**项目 CTB 真地形（`/static/terrain/`）能否与
 * 3D Tiles 共存**。判据不在「能不能渲染」，而在瓦片内容里**有没有地表**：
 *
 * - `qinzhou-port` 的 t0~t3 层是 REPLACE 地形网格（面/顶点比 ≈ 1.95 的规则格网，
 *   实测 Z 跨度 7.17 m / XY 跨度 1617×1855 m）⇒ 与 CTB 地形叠加即**两层地表**；
 * - `bim-madao` 只有 IFC 构件，无地表 ⇒ 与地形叠加不产生「双层地形」，
 *   剩下的只是锚点高程基准差（椭球高 vs 正高）。
 *
 * 两者放在同一份清单里，是为了让「自带地形的 tileset 与纯构筑物 tileset 表现不同」
 * 这件事在代码层面上就可见，而不是只活在某次实测结论里。
 */

/** 资产 id（图层 id 后缀，与注册时的 `beibu-` + id 拼装一致） */
export type BeibuTilesId =
  | 'qinzhou-port'
  | 'qz-terminal-bim'
  | 'bim-madao'
  | 'bim-qishi'
  | 'bim-qingnian'

export interface BeibuTilesSpec {
  id: BeibuTilesId
  /** 图层面板显示名 */
  label: string
  /** tileset.json 地址（后端 static 托管） */
  url: string
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

/** 图层 id 前缀（图层面板 layer-order 与注册共用） */
export const BEIBU_TILES_LAYER_PREFIX = 'beibu-'

/** 由资产 id 得到图层 id（如 'qinzhou-port' → 'beibu-qinzhou-port'） */
export function beibuTilesLayerId(id: BeibuTilesId): string {
  return BEIBU_TILES_LAYER_PREFIX + id
}

/**
 * 资产表。**交付包里的全部三维瓦片都在这**（2026-09-28 传输包 01 + 04 两个目录）。
 *
 * `maximumScreenSpaceError` 刻意区分：钦州港单块细瓦片可达 13 MB、整包 144 MB，
 * 取 32（放宽屏幕误差）压首屏请求量；BIM 构件总量小，取 16 保住构件细节。
 *
 * `defaultVisible` 全为 `true`：用户要"带回来的全部加载起来"，第一眼就要看到。
 * 代价是首屏会拉数百 MB，面板里逐条关掉即可（图层控制面板按 layer-order 常驻条目）。
 */
export const BEIBU_TILES: readonly BeibuTilesSpec[] = [
  {
    id: 'qinzhou-port',
    label: '钦州港 · 核心区三维',
    url: '/static/qinzhou-port/tiles/tileset.json',
    carriesTerrain: true,
    maximumScreenSpaceError: 32,
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
  {
    id: 'bim-madao',
    label: '平陆运河 · 马道枢纽 BIM',
    url: '/static/bim-hub/pinglu-madao-hub/tileset.json',
    carriesTerrain: false,
    maximumScreenSpaceError: 16,
    defaultVisible: true,
  },
  {
    id: 'bim-qishi',
    label: '平陆运河 · 企石枢纽 BIM',
    url: '/static/bim-hub/pinglu-qishi-hub/tileset.json',
    carriesTerrain: false,
    maximumScreenSpaceError: 16,
    defaultVisible: true,
  },
  {
    id: 'bim-qingnian',
    label: '平陆运河 · 青年枢纽 BIM',
    url: '/static/bim-hub/pinglu-qingnian-hub/tileset.json',
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
 * （钦州保税港区 108.647304 / 21.674497）；平陆三枢纽取自项目 Cesium 反算的
 * tile 包围球中心（马道 108.92854/22.42986、企石 108.94559/22.33099、
 * 青年 108.66890/22.03019）。
 */
export const BEIBU_TILES_VIEWS: Record<BeibuTilesId, { lng: number; lat: number; height: number }> =
  {
    'qinzhou-port': { lng: 108.6473, lat: 21.6745, height: 6000 },
    'qz-terminal-bim': { lng: 108.6473, lat: 21.6745, height: 1800 },
    'bim-madao': { lng: 108.92854, lat: 22.42986, height: 1600 },
    'bim-qishi': { lng: 108.94559, lat: 22.33099, height: 1600 },
    'bim-qingnian': { lng: 108.6689, lat: 22.03019, height: 1600 },
  }

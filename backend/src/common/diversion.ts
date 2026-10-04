// 分流分析框架（论文 W10-11；数据锚点出处见后端 scenario.constants.ts 头注释与
// .local/papers/提取-运河参数-2026-09-26.md §二/§四，罗淳 2024 §5.3.4/附录 A-6）。
//
// 核心事实（罗淳 §5.3.4 原话）：长洲下行 79% 是砂石水泥类（碎石42%+水泥14%+石粉14%+
// 石灰石9%），目的地为广东本地建设，"经西江-珠江内河运输直接且效率高……不可能转移至
// 平陆运河"——可分流基数只看上行调入货（煤/粮/矿），这是本模块的负结果锚点。

interface WestRiverTransfer {
  /** 年份 */
  year: number
  /** 煤炭（万吨/年） */
  coal: number
  /** 粮食（万吨/年） */
  grain: number
  /** 铁矿石（万吨/年） */
  ironOre: number
  /** 砂石水泥类——恒 0（罗淳 §5.3.4：不可能转移） */
  sandCement: number
}

/** 西江→运河转移量锚点（罗淳直接可用预测；线性插值，域外 clamp） */
export const WEST_RIVER_TRANSFER_ANCHORS: readonly WestRiverTransfer[] = [
  { year: 2030, coal: 386.89, grain: 783.47, ironOre: 294.06, sandCement: 0 },
  { year: 2040, coal: 470.47, grain: 891.64, ironOre: 333.22, sandCement: 0 },
  { year: 2050, coal: 522.48, grain: 996.74, ironOre: 361.22, sandCement: 0 },
]

/** 长洲船闸过闸量基线（对照组；罗淳附录 A-6，万吨） */
export const CHANGZHOU_LOCK_SERIES: readonly { year: number; through: number }[] = [
  { year: 2007, through: 2518 },
  { year: 2008, through: 3627 },
  { year: 2009, through: 4433 },
  { year: 2010, through: 3928 },
  { year: 2011, through: 4292 },
  { year: 2012, through: 5377 },
  { year: 2013, through: 6000 },
  { year: 2014, through: 6646 },
  { year: 2015, through: 6344.5 },
  { year: 2016, through: 6871 },
  { year: 2017, through: 9880 },
  { year: 2018, through: 13179.2 },
  { year: 2019, through: 14535.4 },
  { year: 2020, through: 15103 },
  { year: 2021, through: 15227.38 },
  { year: 2022, through: 15528.41 },
]

/** 任意年西江转移量：锚点间线性插值，域外取最近锚点（clamp，不外推） */
export function westRiverTransferAt(year: number): WestRiverTransfer {
  const anchors = WEST_RIVER_TRANSFER_ANCHORS
  if (year <= anchors[0].year) return { ...anchors[0] }
  const last = anchors[anchors.length - 1]
  if (year >= last.year) return { ...last }
  let i = 0
  while (anchors[i + 1].year < year) i++
  const a = anchors[i]
  const b = anchors[i + 1]
  const t = (year - a.year) / (b.year - a.year)
  const lerp = (x: number, y: number) => x + (y - x) * t
  return {
    year,
    coal: lerp(a.coal, b.coal),
    grain: lerp(a.grain, b.grain),
    ironOre: lerp(a.ironOre, b.ironOre),
    sandCement: 0,
  }
}

export interface DiversionBreakdown {
  /** 西江内河通道向运河的转移量（万吨/年） */
  transfer: WestRiverTransfer
  /** 转移量按港口分摊（吨→吨/年；份额与 F3 情景层同源） */
  byPort: Record<string, { coal: number; grain: number; ironOre: number; total: number }>
  /** 桑基图边：1 条「西江上行货→平陆运河」+ 3 条「平陆运河→各港中文名」 */
  sankeyFlows: Array<{ from: string; to: string; value: number }>
}

/**
 * 港口 id → 中文显示名（只用于桑基节点文本；byPort 的键仍是数据 id，契约不动）。
 *
 * 权威源：frontend/src/shared/constants/forecast.ts 的 PORT_PORTS（北部湾三港唯一权威
 * 映射：qinzhou→钦州港 / beihai→北海港 / fangchenggang→防城港）；键集与
 * CANAL_PORT_SHARES 一致，tools/forecast/throughput_model.cjs 的 PORT_NAMES 同值互证。
 * 后端不反向 import 前端层（backend/tsconfig.build.json rootDir=./，跨层引用编译即红），
 * 故本表是契约镜像而非第二权威源：diversion.spec 用跨边界断言逐键比对 PORT_PORTS，
 * 前端改名或本表漂移都会红。
 *
 * 失效条件：CANAL_PORT_SHARES 新增港口键而本表未同步时，diversionBreakdown 对未知 id
 * 显式抛错——不允许 id/拼音冒充节点文本回流到桑基图。
 */
export const PORT_DISPLAY_NAMES: Record<string, string> = {
  qinzhou: '钦州港',
  beihai: '北海港',
  fangchenggang: '防城港',
}

/**
 * 分流分解：西江转移量 × 港口分摊（份额须与 CANAL_PORT_SHARES 同源同和）。
 * 桑基图三段口径：来源=西江上行货类，通道=平陆运河，目的地=三港（中文显示名）；
 * 砂石支路恒 0 不出边。byPort 的键保持数据 id。
 */
export function diversionBreakdown(
  year: number,
  portShares: Record<string, number>
): DiversionBreakdown {
  const shareSum = Object.values(portShares).reduce((a, b) => a + b, 0)
  if (Math.abs(shareSum - 1) > 1e-9) {
    throw new Error(`港口份额和 ≠ 1（${shareSum}）`)
  }
  const transfer = westRiverTransferAt(year)
  const byPort: DiversionBreakdown['byPort'] = {}
  const portLegs: Array<{ name: string; total: number }> = []
  for (const [port, share] of Object.entries(portShares)) {
    const name = PORT_DISPLAY_NAMES[port]
    if (name === undefined) {
      throw new Error(`未知港口 id（缺中文显示名）: ${port}`)
    }
    const coal = transfer.coal * share
    const grain = transfer.grain * share
    const ironOre = transfer.ironOre * share
    const total = coal + grain + ironOre
    byPort[port] = { coal, grain, ironOre, total }
    portLegs.push({ name, total })
  }
  const sankeyFlows: DiversionBreakdown['sankeyFlows'] = [
    {
      from: '西江上行货',
      to: '平陆运河',
      value: transfer.coal + transfer.grain + transfer.ironOre,
    },
    ...portLegs.map((leg) => ({ from: '平陆运河', to: leg.name, value: leg.total })),
  ]
  return { transfer, byPort, sankeyFlows }
}

/**
 * 运河线位响应（GET /diversion/canal-line，Cesium ③ 弧线图层几何底座）。
 *
 * 84-only 流通：库内 4490（CGCS2000）存储已在 SQL 侧 ST_Transform 到 4326，
 * 本接口只出裸经纬度对、不带 crs 声明（04-B 坐标系纪律：4490 只许存储不许流通）。
 * 权威源 = 权威库 canal 表；真线位（PBF 校验五条通过后）替换表内容即全链生效，
 * 前端与契约零改动。
 */
export interface CanalLineResponse {
  lines: Array<{
    name: string | null
    section: string | null
    coordinates: Array<[number, number]>
  }>
}

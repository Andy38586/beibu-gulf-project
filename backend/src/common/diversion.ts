// 分流分析框架（论文 W10-11；数据锚点出处见后端 scenario.constants.ts 头注释与
// .local/papers/提取-运河参数-2026-09-26.md §二/§四，罗淳 2024 §5.3.4/附录 A-6）。
//
// 核心事实（罗淳 §5.3.4 原话）：长洲下行 79% 是砂石水泥类（碎石42%+水泥14%+石粉14%+
// 石灰石9%），目的地为广东本地建设，"经西江-珠江内河运输直接且效率高……不可能转移至
// 平陆运河"——可分流基数只看上行调入货（煤/粮/矿），这是本模块的负结果锚点。

export interface WestRiverTransfer {
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
  /** 桑基图节点流（来源→通道→港口），v1 只含西江转移一支 */
  sankeyFlows: Array<{ from: string; to: string; value: number }>
}

/**
 * 分流分解：西江转移量 × 港口分摊（份额须与 CANAL_PORT_SHARES 同源同和）。
 * 桑基图 v1 口径：来源=西江上行货类，通道=平陆运河，目的地=三港；砂石支路恒 0 不出边。
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
  const sankeyFlows: DiversionBreakdown['sankeyFlows'] = []
  for (const [port, share] of Object.entries(portShares)) {
    const coal = transfer.coal * share
    const grain = transfer.grain * share
    const ironOre = transfer.ironOre * share
    byPort[port] = { coal, grain, ironOre, total: coal + grain + ironOre }
    sankeyFlows.push({ from: '西江上行货', to: `平陆运河→${port}`, value: coal + grain + ironOre })
  }
  return { transfer, byPort, sankeyFlows }
}

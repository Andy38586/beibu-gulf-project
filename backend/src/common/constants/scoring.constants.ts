// 选址评分参数（site-analysis 模块业务参数集中归档，供魔法值审计与逐行等价比对）；
// 数值为 Express scoringService 等价移植基线，改动必须过双后端 diff 回归

/** 重要程度 → 半径放大系数（1~5 档；非表项输入取整夹取后取档） */
export const IMPORTANCE_FACTOR: Record<number, number> = {
  1: 0.4,
  2: 0.7,
  3: 1.0,
  4: 1.5,
  5: 2.2,
}

/** 六类设施默认权重（与 Express 侧一致） */
export const DEFAULT_WEIGHTS: Record<string, number> = {
  hospital: 1.2,
  primary_school: 1.0,
  middle_school: 1.0,
  park: 0.8,
  bus_station: 0.6,
  mall: 0.7,
}

/** 评分排序取前 N 名（557 小区规模下取前 10 覆盖可达性核心结论区间，
 * 前端 SiteSelectionPage 另行 slice(0,8) 展示截断，不硬依赖本值；如数据翻倍需重评估） */
export const TOP_N = 10

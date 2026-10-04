// 选址默认值快照（前端兜底副本，权威源 = 后端 GET /site-suitability/defaults）。
//
// 为什么是快照而不是"前端配一份"：权重定稿向量以后端 SITE_AHP_MATRIX 为准
// （用户 2026-10-04 裁决）；前端恒传旧权重曾让后端缺省分支生产走不到，
// 同一事实两份手抄是根因。本文件是后端定稿值的发布副本，只在拉不到端点时
// 启用，且启用时走 logger.warn 留痕（成功走 info），生产控制台"无 warn =
// 直连、有 warn = 兜底"，UI 无区别。落盘位置在 stores/ 同层而非 business/
// constants：04-E1 明令 stores 不 import business，store 初值/reset 又必须
// 读它——它是 store 初始态的一部分，不是业务逻辑。
//
// 对齐守卫：本文件数值变化必须同步改后端 defaults 单测的 FINAL_WEIGHTS，
// 双向断言见 frontend/src/stores/__tests__/siteSuitabilityStore.defaults.test.ts
// （快照 ≈ 定稿 1e-4）与 backend/test/site-suitability-defaults.spec.ts。
/** 权重向量形状（定义在此：store 只读本文件，禁回指——cruise 禁止两文件成环） */
export interface SuitabilityWeightsState {
  inundation: number
  terrain: number
  land: number
  access: number
  demand: number
}

/** AHP 定稿特征向量全精度（与后端 defaultWeights 同值，顺序无关，键对齐） */
export const SNAPSHOT_WEIGHTS: SuitabilityWeightsState = {
  inundation: 0.42993537381873326,
  terrain: 0.08451837333607896,
  land: 0.20591100060530831,
  access: 0.10971791699328601,
  demand: 0.1699173352465935,
}

export const SNAPSHOT_MIN_LAND_FRAC = 0.5

export const SNAPSHOT_RESOLUTION = 0

/** 阈值表定稿值镜像（前端暂无消费方，随 defaults schema 做形状守卫，不手抄第二份） */
export const SNAPSHOT_THRESHOLDS = {
  inundLowM: 1,
  inundHighM: 6,
  slopeBestDeg: 5,
  slopeWorstDeg: 20,
  portScaleM: 8000,
  roadScaleM: 2000,
} as const

/** 快照身份：每次 warn 兜底时原样输出，凭它判定"这次是兜底" */
export const SNAPSHOT_PROVENANCE = {
  source: 'SITE_AHP_MATRIX@2026-09-30',
  backendCommit: 'a7f0cdb0',
  generatedAt: '2026-10-04',
  generator: 'backend/test/site-suitability-defaults.spec.ts FINAL_WEIGHTS',
} as const

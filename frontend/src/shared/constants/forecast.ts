/**
 * 预测分析共享常量（单一事实源，P7：business/forecast/constants.ts 兼容层已删）
 * 为什么在 shared/constants 而不是 business/forecast/constants：
 * - stores/forecastState.ts（store 层）需要 DEFAULT_CONFIDENCE 初始化置信度阈值
 * - 项目分层铁律：stores → business 禁止引（business → core 才允许）
 * - 若常量留在 business，store 反向依赖 business 会破坏分层（dependency-cruiser 会报错）
 * - 将共享常量上提到 shared，store 与 business 两层都从此取，单向依赖保持
 * 2026-08-10 复核（面试报告 P1-8）：上提是分层铁律（z047/z043 归档）驱动的正当设计，
 * 非"绕过 lint"——本注释即该决策的书面依据，保留。
 */

/** 默认置信度阈值（各指标共用） */
export const DEFAULT_CONFIDENCE = 0.8

/**
 * 预测时间轴起止年（单一事实源，c018）
 * forecastState（store 层）需要据此派生 timeRange 起止，而 stores → business
 * 反向依赖被分层铁律禁止，故共享常量归 shared。
 */
export const BASE_YEAR = 2021
export const END_YEAR = 2031

/** 北部湾三港名称与 key 映射（P7：自 business/forecast/constants.ts 上移） */
export const PORT_NAMES = ['钦州港', '北海港', '防城港'] as const
export const PORT_KEYS = ['qinzhou', 'beihai', 'fangchenggang'] as const

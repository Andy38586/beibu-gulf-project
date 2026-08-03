/**
 * 预测分析共享常量（单一事实源）
 * 为什么在 shared/constants 而不是 business/forecast/constants：
 * - stores/forecastState.ts（store 层）需要 DEFAULT_CONFIDENCE 初始化置信度阈值
 * - 项目分层铁律：stores → business 禁止引（business → core 才允许）
 * - 若常量留在 business，store 反向依赖 business 会破坏分层（dependency-cruiser 会报错）
 * - 将共享常量上提到 shared，store 与 business 两层都从此取，单向依赖保持
 * 业务专属常量（PORT_NAMES/PORT_KEYS/BASE_YEAR/END_YEAR 等）仍留在
 * business/forecast/constants.ts 并从本文件 re-export，业务侧引用零改动。
 */

/** 默认置信度阈值（各指标共用） */
export const DEFAULT_CONFIDENCE = 0.8

/**
 * 预测时间轴起止年（单一事实源，c018）
 * 与 DEFAULT_CONFIDENCE 上提到 shared 的原因一致：forecastState（store 层）需要据此
 * 派生 timeRange 起止，而 stores → business 反向依赖被分层铁律禁止，故共享常量归 shared。
 * business/forecast/constants.ts 从本文件 re-export，业务侧引用零改动。
 */
export const BASE_YEAR = 2021
export const END_YEAR = 2031

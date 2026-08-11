/**
 * 预测分析共享常量（单一事实源）：store 层初始化需要 DEFAULT_CONFIDENCE 与时间轴起止年，
 * 而分层铁律禁止 stores 反向依赖 business，故上提到 shared 供两层共用。
 */

/** 默认置信度阈值（各指标共用） */
export const DEFAULT_CONFIDENCE = 0.8

/** 预测时间轴起止年 */
export const BASE_YEAR = 2021
export const END_YEAR = 2031

/** 北部湾三港名称与 key 映射 */
export const PORT_NAMES = ['钦州港', '北海港', '防城港'] as const
export const PORT_KEYS = ['qinzhou', 'beihai', 'fangchenggang'] as const

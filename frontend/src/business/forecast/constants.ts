/**
 * 预测分析域常量（c018：消除散落魔法值）
 */

/** 默认置信度阈值（各指标共用） */
export const DEFAULT_CONFIDENCE = 0.8

/** 预测时间范围（年） */
export const BASE_YEAR = 2023
export const END_YEAR = 2035

/** 北部湾三港名称与 key 映射 */
export const PORT_NAMES = ['钦州港', '北海港', '防城港'] as const
export const PORT_KEYS = ['qinzhou', 'beihai', 'fangchenggang'] as const

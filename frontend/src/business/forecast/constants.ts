/**
 * 预测分析域常量（c018：消除散落魔法值）
 *
 * DEFAULT_CONFIDENCE 已上提到 shared/constants/forecast.ts（stores 层需要引用，
 * 按分层铁律 stores → business 禁止引，故共享常量归 shared）。
 * 此处 re-export 保持业务侧既有引用零改动。
 */
export { DEFAULT_CONFIDENCE } from '@/shared'

/**
 * 预测时间轴起止年（c018）。
 * 已上提到 shared/constants/forecast.ts 作为单一事实源（store 层禁用 business 反向依赖），
 * 此处 re-export 保持业务侧既有引用零改动。
 */
export { BASE_YEAR, END_YEAR } from '@/shared'

/** 北部湾三港名称与 key 映射 */
export const PORT_NAMES = ['钦州港', '北海港', '防城港'] as const
export const PORT_KEYS = ['qinzhou', 'beihai', 'fangchenggang'] as const

/**
 * 预测分析共享常量（单一事实源）：store 层初始化需要 DEFAULT_CONFIDENCE 与时间轴起止年，
 * 而分层铁律禁止 stores 反向依赖 business，故上提到 shared 供两层共用。
 */

/** 默认置信度阈值（各指标共用） */
export const DEFAULT_CONFIDENCE = 0.8

/** 预测时间轴起止年 */
export const BASE_YEAR = 2021
export const END_YEAR = 2031

/**
 * 北部湾三港（单一事实源，顺序即图表 x 轴与 series 的展示顺序）。
 * PORT_KEYS 与 PORT_NAMES 的下标**必须一一对应**——此前 PORT_KEYS 定义了却零引用，
 * 消费端（useForecastComparison）手写 3 个 key 取数，顺序靠人眼与 PORT_NAMES 对齐，
 * 属于「定义与使用不成对」。现以 PORT_PORTS 作为唯一权威映射，两个数组由它派生。
 */
export const PORT_PORTS = [
  { key: 'qinzhou', name: '钦州港' },
  { key: 'beihai', name: '北海港' },
  { key: 'fangchenggang', name: '防城港' },
] as const

export type PortKey = (typeof PORT_PORTS)[number]['key']

/** 港口 key 列表（顺序权威） */
export const PORT_KEYS = PORT_PORTS.map((p) => p.key)
/** 港口中文名列表（顺序与 PORT_KEYS 严格对齐） */
export const PORT_NAMES = PORT_PORTS.map((p) => p.name)

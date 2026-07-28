/**
 * 预测分析数据模型（types/api/forecast.ts）
 *
 * 对应 public/data/forecast/*.json 的真实结构。
 *
 * ── D1 校正说明（重要）──
 * 最初的设计稿把"统一结构"设想为：
 *     ForecastIndicator { time: string; value: number; level: number }
 * 但实测 mock 数据（throughput.json / berth.json）中【不存在 level 字段】，
 * 取而代之的是 type 判别字段（'historical' | 'forecast'）。
 * 因此统一为 ForecastPoint，用 type 而不是 level 作为历史/预测的区分。
 *
 * 这是"数据流类型"由数据事实决定的例子：AI 不替业务发明字段，
 * 只把已存在的数据形状如实类型化。若你后续想加"置信度等级"之类，
 * 那是新增业务字段，在 ForecastPoint 上扩一个可选属性即可。
 */

/** 港口 id（字符串，不预设枚举，兼容未来新增港口） */
export type PortId = string

/** 单个预测数据点（历史 / 预测统一结构） */
export interface ForecastPoint {
  /** 时间标签，如 "2018-01" */
  time: string
  /** 指标值，单位见所属 ForecastSeries.unit */
  value: number
  /** 数据性质：历史实测 或 模型预测 —— 这是真实数据里的判别字段 */
  type: 'historical' | 'forecast'
}

/** 单港口的历史序列 + 可选预测序列 */
export interface ForecastPortSeries {
  historical: ForecastPoint[]
  forecast?: ForecastPoint[]
}

/** 预测指标完整响应（对应 public/data/forecast/*.json 顶层） */
export interface ForecastSeries {
  /** 指标标识，如 "throughput"（吞吐量）/ "berth"（泊位利用率） */
  indicator: string
  /** 单位，如 "万吨" / "%" */
  unit: string
  /** 按港口分组的序列，key 为港口 id（如 "qinzhou" / "beibu"） */
  data: Record<PortId, ForecastPortSeries>
}

/**
 * 已知指标名（宽松联合：已知值 + 兜底 string）。
 * 用于 adapter 返回时给调用方一点提示，但不强制穷举。
 */
export type ForecastIndicatorName = 'throughput' | 'berth' | (string & {})

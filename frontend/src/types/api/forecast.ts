/**
 * 预测分析数据模型，对应 public/data/forecast/*.json 的真实结构。
 * 关键事实：真实数据用 type（'historical' | 'forecast'）判别历史/预测，无 level 字段；
 * 类型只如实反映数据形状，新增字段时在 ForecastPoint 上扩可选属性即可。
 */

/** 港口 id（字符串，不预设枚举，兼容未来新增港口） */
export type PortId = string

/** 单个预测数据点（历史 / 预测统一结构） */
export interface ForecastPoint {
  /** 时间标签，如 "2018-01" */
  time: string
  /** 指标值，单位见所属数据文件的 unit 字段 */
  value: number
  /** 数据性质：历史实测 或 模型预测 */
  type: 'historical' | 'forecast'
  /** 置信度（数据文件自带；schema 已补可选字段防止剥除） */
  confidence?: number
}

/** 地图热力图响应（对应后端 /forecast/map 的 data 字段） */
export interface ForecastMapData {
  indicator: string
  unit: string
  time: string
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: { type: string; coordinates: number[] }
    properties: {
      portId: string
      portName: string
      value: number
      reliability: number
    }
  }>
}

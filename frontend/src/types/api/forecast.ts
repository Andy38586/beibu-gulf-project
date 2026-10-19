/**
 * 预测分析数据模型，对应 public/data/forecast/*.json 的真实结构。
 *
 * 只留地图热力图响应：原 `PortId`（= string 纯别名）与 `ForecastPoint` 全仓零消费
 * （后端同名件在 forecast-engine.ts，是另一件），2026-10-19 必要性审判删除。
 */

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

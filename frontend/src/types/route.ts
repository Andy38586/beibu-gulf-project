/**
 * 航线分析（RouteAnalysis）类型：最短路径 API 响应契约。
 * 坐标命名 lng/lat（03 §1.2 词汇表）；路径折线 coordinates 为 [[lng,lat],...]。
 */

/** 路径查询参数（前端 → GET /route/path） */
export interface RoutePathParams {
  fromLng: number
  fromLat: number
  toLng: number
  toLat: number
  /** 权重口径：distance=距离（米）/ time=时长（分） */
  mode?: 'distance' | 'time'
}

/** 路径查询成功结果 */
export interface RoutePathResult {
  found: true
  mode: 'distance' | 'time'
  /** 路网边累计距离（米，不含接驳段） */
  distanceM: number
  /** 路网边累计时长（分，不含接驳段） */
  durationMin: number
  /** 起终点吸附接驳距离（米，直线，前端可叠加展示） */
  snapDistanceM: { from: number; to: number }
  edgeCount: number
  /** 路径折线 [[lng,lat],...] */
  coordinates: [number, number][]
}

/** 路径查询合法空结果（不可达 / 起终点未吸附——断链语义，合法空非错误） */
export interface RouteEmptyResult {
  found: false
  /** 空因：origin_not_snapped / destination_not_snapped / unreachable */
  reason: 'origin_not_snapped' | 'destination_not_snapped' | 'unreachable'
}

/** 路径查询响应（后端绝不 500：不可达/未吸附走合法空信封） */
export type RoutePathResponse = RoutePathResult | RouteEmptyResult

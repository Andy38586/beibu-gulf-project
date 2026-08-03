/**
 * GIS 业务数据基础模型
 *
 * 定义所有 GIS 数据特征的基础类型。
 * 业务模块（浸没分析、选址分析、预测分析）继承此基础结构扩展自有属性。
 *
 * 坐标系统约定：
 *   全项目统一 WGS84(EPSG:4326) lng/lat，投影到 Web Mercator(EPSG:3857) 由 OL/Cesium 内部处理。
 *   北部湾区域横跨 108°E，处于 UTM 49N/50N 交界带，前端不直接做投影运算。
 */

// ===== 通用 GIS 要素 =====

/** 坐标点（业务层统一使用 lng/lat，WGS84 地理坐标系） */
export interface GeoPoint {
  lng: number
  lat: number
}

/** 带属性标注的点 */
export interface AnnotatedPoint extends GeoPoint {
  id: string
  name: string
  /** 开放扩展：点要素可携带业务属性（如 port、type），
   *  供渲染器/弹窗按需读取。参考 §7.7。 */
  [key: string]: unknown
}

/** 通用 GIS 要素 */
export interface GeoFeature<T extends Record<string, unknown> = Record<string, unknown>> {
  geometry: {
    type: 'Point' | 'Polygon' | 'MultiPolygon'
    coordinates: number[] | number[][] | number[][][]
  }
  /** 泛型属性，由具体业务类型参数化（如 FloodFeature.properties、ScoredFeature.properties）。 */
  properties: T
}

/** 带计算得分的要素 */
export interface ScoredFeature<T extends Record<string, unknown> = Record<string, unknown>> {
  feature: GeoFeature<T>
  score: number
  breakdown: Record<string, number>
}

// ===== 浸没分析业务类型 =====

/** 淹没统计数据
 *
 * b033: 契约对齐——移除 [key: string]: unknown 索引签名逃生舱，
 * 显式声明后端 floodStatistics.json 返回的字段 + adapter 派生字段。
 * riskLevel 为必填（所有数据源均提供）；其余字段按数据源可选。
 */
export interface FloodStatistics {
  riskLevel: string // 风险等级（所有数据源均提供）
  // —— 后端 floodStatistics.json 原始字段（mock/api 模式有值，online 模式缺失）——
  waterLevel?: number // 水位档位（m）
  floodArea?: number // 淹没面积（km²）
  averageDepth?: number // 平均水深（m）
  maxDepth?: number // 最大水深（m）
  affectedFacilities?: number // 受影响设施数量（计数，非数组）
  affectedPorts?: string[] // 受影响港口列表
  estimatedLoss?: number // 预估损失（万元）
  description?: string // 情景描述
  // —— adapter 派生字段（online 模式有值，mock/api 模式可能缺失）——
  totalArea?: number // 淹没总面积（平方米，online 模式由 floodedKm2 换算）
  affectedCount?: number // 受影响设施数量（与 affectedFacilities 同语义，online 模式占位）
}

/** 淹没区域要素（GeoJSON Feature） */
export interface FloodFeature {
  type: 'Feature'
  geometry: {
    type: 'Polygon' | 'MultiPolygon'
    coordinates: number[][][] | number[][][][]
  }
  properties: {
    riskLevel: string
    depth?: number
    /** 开放扩展：淹没要素可携带 areaId、submergedArea 等业务属性。
     *  参考 §7.7。 */
    [key: string]: unknown
  }
}

/** 受影响设施 */
export interface AffectedFacility {
  id: string
  name: string
  type: string
  lng: number
  lat: number
  port?: string
  loss: number
  damageRate: number
}

/** 淹没分析保存状态 */
export interface FloodSavedState {
  waterLevel: number
  floodStatistics: FloodStatistics | null
  floodFeatures: FloodFeature[]
  floodRiskLevel: string
  affectedFacilities: AffectedFacility[]
  totalLoss: number
}

/** 淹没分析消费状态 */
export interface FloodConsumedState {
  waterLevel: number
  floodStatistics: FloodStatistics | null
  floodFeatures: FloodFeature[]
  floodRiskLevel: string
  affectedFacilities?: AffectedFacility[]
  totalLoss?: number
}

// ===== 预测分析业务类型 =====

/** 预测时间范围 */
export interface ForecastTimeRange {
  start: string
  end: string
  current: string
}

/** 置信度阈值 */
export interface ConfidenceThresholds {
  cargo: number
  container: number
  berth: number
  traffic: number
  /** 开放扩展：未来可能新增指标（如 gdp、population）的置信度阈值。
   *  参考 §7.7。 */
  [key: string]: number
}

/** 预测数据缓存 */
export interface ForecastData {
  [key: string]: unknown
}

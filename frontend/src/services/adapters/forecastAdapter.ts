/**
 * forecastAdapter — 预测数据适配器：统一 Nest 后端 /forecast/*（全局前缀按功能域解析）的
 * 请求与 zod 校验，隔离业务层与 HTTP 细节；返回业务形状，图表直接消费、零原始字段透传。
 */
import { ENDPOINTS, useApiRequest } from '@/shared'
import type {
  ForecastIndicatorIndexParsed,
  IndicatorComparisonResponseParsed,
  TimeSeriesResponseParsed,
} from '@/types/schemas'
import {
  forecastIndicatorIndexSchema,
  indicatorComparisonResponseSchema,
  timeSeriesResponseSchema,
} from '@/types/schemas'

const { apiRequest } = useApiRequest()

/** 缺省不携带 scenario 参数：与「未选情景=后端默认基线」的请求语义一致 */
function scenarioParam(scenario?: string): Record<string, string> {
  return scenario ? { scenario } : {}
}

export interface ForecastTimeSeriesParams {
  indicator: string
  granularity: string
  confidence: number
  /** 运河情景（仅 cargo 有意义；缺省不传参，后端默认 baseline） */
  scenario?: string
}

export type ForecastTimeSeriesResult = Pick<TimeSeriesResponseParsed, 'series'>

export interface ForecastComparisonParams {
  time: string
  confidence: number
  /** 运河情景（仅 cargo 有意义；缺省不传参，后端默认 baseline） */
  scenario?: string
}

export type ForecastComparisonResult = Pick<IndicatorComparisonResponseParsed, 'ports'>

export const forecastAdapter = {
  /** 首页概览静态快照（/forecast/overview）：图表数据，schema 校验在 HTTP 边界完成 */
  async getOverview(signal?: AbortSignal): Promise<ForecastIndicatorIndexParsed> {
    return apiRequest<ForecastIndicatorIndexParsed>(ENDPOINTS.forecast.overview, {
      signal,
      schema: forecastIndicatorIndexSchema,
    })
  },

  /** 趋势时序（/forecast/timeseries）：schema 校验在 HTTP 边界完成，返回解析后业务形状 */
  async getTimeSeries(
    params: ForecastTimeSeriesParams,
    signal?: AbortSignal
  ): Promise<ForecastTimeSeriesResult> {
    const data = await apiRequest<TimeSeriesResponseParsed>(ENDPOINTS.forecast.timeseries, {
      method: 'GET',
      params: {
        indicator: params.indicator,
        granularity: params.granularity,
        confidence: params.confidence,
        ...scenarioParam(params.scenario),
      },
      signal,
      schema: timeSeriesResponseSchema,
    })
    return { series: data.series }
  },

  /** 港口对比（/forecast/indicator/:indicator）：同上，schema 校验后透传 ports */
  async getIndicatorComparison(
    indicator: string,
    params: ForecastComparisonParams,
    signal?: AbortSignal
  ): Promise<ForecastComparisonResult> {
    const data = await apiRequest<IndicatorComparisonResponseParsed>(
      ENDPOINTS.forecast.indicator(indicator),
      {
        method: 'GET',
        params: {
          time: params.time,
          confidence: params.confidence,
          ...scenarioParam(params.scenario),
        },
        signal,
        schema: indicatorComparisonResponseSchema,
      }
    )
    return { ports: data.ports }
  },
}

/**
 * forecastAdapter — 预测数据适配器（专项1 [2.5]）：统一 Express 后端 /forecast/* 的
 * 请求与 zod 校验，隔离业务层与 HTTP 细节；返回业务形状，图表直接消费、零原始字段透传。
 */
import { useApiRequest } from '@/shared'
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

export interface ForecastTimeSeriesParams {
  indicator: string
  granularity: string
  confidence: number
}

export type ForecastTimeSeriesResult = Pick<TimeSeriesResponseParsed, 'series'>

export interface ForecastComparisonParams {
  time: string
  confidence: number
}

export type ForecastComparisonResult = Pick<IndicatorComparisonResponseParsed, 'ports'>

export const forecastAdapter = {
  /** 首页概览静态快照（/forecast/overview）：图表数据，schema 校验在 HTTP 边界完成（副-02 收口） */
  async getOverview(signal?: AbortSignal): Promise<ForecastIndicatorIndexParsed> {
    return apiRequest<ForecastIndicatorIndexParsed>('/forecast/overview', {
      signal,
      schema: forecastIndicatorIndexSchema,
    })
  },

  /** 趋势时序（/forecast/timeseries）：schema 校验在 HTTP 边界完成，返回解析后业务形状 */
  async getTimeSeries(
    params: ForecastTimeSeriesParams,
    signal?: AbortSignal
  ): Promise<ForecastTimeSeriesResult> {
    const data = await apiRequest<TimeSeriesResponseParsed>('/forecast/timeseries', {
      method: 'GET',
      params: {
        indicator: params.indicator,
        granularity: params.granularity,
        confidence: params.confidence,
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
      `/forecast/indicator/${indicator}`,
      {
        method: 'GET',
        params: { time: params.time, confidence: params.confidence },
        signal,
        schema: indicatorComparisonResponseSchema,
      }
    )
    return { ports: data.ports }
  },
}

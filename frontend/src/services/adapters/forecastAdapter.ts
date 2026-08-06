/**
 * Forecast Data Adapter
 * 职责：隔离预测分析业务层与数据源。
 * 接入状态（2026-07-29）：
 * - ForecastPage 已通过 useForecastRequest → forecastAdapter.getTimeSeries / getIndicatorComparison 取数，
 * 不再直接调 useApiRequest，Adapter 模式一致性已恢复。
 * - static 模式：读取 public/data/forecast/*.json 静态 fixture。
 * - api 模式：通过 useApiRequest 调用后端 /forecast/timeseries、/forecast/indicator/:type，
 * 支持事务取消（AbortSignal 透传）。
 * 注意：ForecastIndicatorIndex.indicators 当前为字符串数组（对齐 index.json 的 metadata.indicators），
 * 非 Array<{key,label,unit}>。后者是早期设计稿的设想，与真实 static 数据不符，已校正。
 */

import { useApiRequest } from '@/shared'
import { loadStatic } from '@/shared'
import type { ForecastSeries } from '@/types/api/forecast'
import {
  forecastIndicatorIndexSchema,
  forecastMapDataSchema,
  indicatorComparisonResponseSchema,
  timeSeriesResponseSchema,
} from '@/types/schemas'

import { resolveDataSource, setAdapterDataSource } from '../dataSourceConfig'

/**
 * 指标索引（对应 public/data/forecast/index.json 的结构）。
 * 注意：index.json 的 indicators 是字符串数组（如 ["cargo","container","berth","traffic"]），
 * 非 Array<{key,label,unit}>。此类型如实反映数据事实。
 */
export interface ForecastIndicatorIndex {
  metadata: {
    version: string
    lastUpdated: string
    ports: Array<{ id: string; name: string; lat: number; lng: number }>
    indicators: string[]
  }
  historical: { start: string; end: string }
  forecast: { start: string; end: string }
}

/** timeseries 响应（对应后端 /forecast/timeseries 的 data 字段） */
export interface TimeSeriesResponse {
  indicator: string
  unit: string
  granularity: string
  series: Array<{
    portId: string
    portName: string
    data: Array<{ time: string; value: number; type: 'historical' | 'forecast' }>
  }>
}

/** indicator 对比响应（对应后端 /forecast/indicator/:type 的 data 字段） */
export interface IndicatorComparisonResponse {
  indicator: string
  unit: string
  ports: Record<
    string,
    {
      portName: string
      value: number | null
      historical: Array<{ time: string; value: number; type: string }>
      forecast: Array<{ time: string; value: number; type: string }>
    }
  >
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

/**
 * static JSON 原始结构（比 ForecastSeries 多 spatial 字段）。
 * ForecastSeries 类型仅描述 historical/forecast，不含 spatial；
 * 此处为 adapter 内部使用的真实 static 文件形状。
 */
interface _StaticForecastFile {
  indicator: string
  unit: string
  data: Record<
    string,
    {
      historical: Array<{ time: string; value: number; type: string }>
      forecast?: Array<{ time: string; value: number; type: string }>
      spatial?: {
        type: string
        features: Array<{
          type: string
          geometry: { type: string; coordinates: number[] }
          properties: { portId: string; portName: string; values: Record<string, number> }
        }>
      }
    }
  >
}

const STATIC_BASE = '/data/forecast'

/**
 * 各指标取数来源（诚实标注，b025 / D-2=A）：
 * - cargo / container 为真实港口吞吐量指标，走后端 API；
 * - berth（泊位利用率）/ traffic（船舶流量）为**示意性合成数据**，放前端静态 fixture
 * （public/data/forecast/*.json），非实测值；UI 侧通过 SYNTHETIC_INDICATORS
 * 对这两个指标显示「（模拟）」角标，避免面试/演示时误读为真实数据。
 * 未显式声明的指标回退到全局 dataSource（由 main.ts 经 adapter.setDataSource 驱动）。
 */
const INDICATOR_SOURCE: Record<string, 'api' | 'static'> = {
  berth: 'static',
  traffic: 'static',
}

/** 合成（非实测）指标集合，供 UI 诚实标注（b025 / D-2=A） */
export const SYNTHETIC_INDICATORS = new Set(
  Object.entries(INDICATOR_SOURCE)
    .filter(([, src]) => src === 'static')
    .map(([key]) => key)
)

const ADAPTER_NAME = 'forecast'

function _resolveSource(indicator: string): 'api' | 'static' {
  return INDICATOR_SOURCE[indicator] ?? resolveDataSource(ADAPTER_NAME)
}

/** 在 static values 字典中查找指定时间的值，找不到时取最近的前一个时间点 */
function _lookupValue(values: Record<string, number>, time: string): number | null {
  if (values[time] != null) return values[time]
  const times = Object.keys(values).sort()
  if (times.length === 0) return null
  let nearest = times[0]
  for (const t of times) {
    if (t <= time) nearest = t
    else break
  }
  return values[nearest] ?? null
}

async function _fetchStatic(indicator: string): Promise<ForecastSeries> {
  // 静态资源 fetch 收口 loadStatic（统一超时 + TTL 缓存 + in-flight 去重）
  const url = `${STATIC_BASE}/${indicator}.json`
  return loadStatic<ForecastSeries>(url)
}

async function _fetchStaticIndex(): Promise<ForecastIndicatorIndex> {
  // 静态资源 fetch 收口 loadStatic
  const url = `${STATIC_BASE}/index.json`
  return loadStatic<ForecastIndicatorIndex>(url)
}

export const forecastAdapter = {
  get dataSource(): string {
    return resolveDataSource(ADAPTER_NAME)
  },

  setDataSource(mode: 'static' | 'api'): void {
    setAdapterDataSource(ADAPTER_NAME, mode)
  },

  /**
   * 获取时序数据（趋势图）。
   * api 模式调用后端 /forecast/timeseries，支持 signal 取消。
   */
  async getTimeSeries(
    indicator: string,
    granularity: string,
    confidence: number,
    signal?: AbortSignal
  ): Promise<TimeSeriesResponse> {
    if (_resolveSource(indicator) === 'static') {
      // static 模式无 timeseries 端点，回退到单指标文件并组装为 series 结构
      const series = await _fetchStatic(indicator)
      const result: TimeSeriesResponse = {
        indicator: series.indicator,
        unit: series.unit,
        granularity,
        series: Object.entries(series.data).map(([portId, portSeries]) => {
          const allData = [...(portSeries.historical || []), ...(portSeries.forecast || [])]
          // 粗粒度按年聚合
          if (granularity === 'year') {
            const yearly: Record<
              string,
              { time: string; value: number; count: number; type: 'historical' | 'forecast' }
            > = {}
            allData.forEach((d) => {
              const y = d.time.split('-')[0]
              if (!yearly[y]) yearly[y] = { time: y, value: 0, count: 0, type: d.type }
              yearly[y].value += d.value
              yearly[y].count++
            })
            return {
              portId,
              portName: portId,
              data: Object.values(yearly).map((d) => ({
                time: d.time,
                value: Math.round(d.value / d.count),
                type: d.type,
              })),
            }
          }
          return { portId, portName: portId, data: allData }
        }),
      }
      return result
    }
    // api 模式
    const { apiRequest } = useApiRequest()
    const resp = await apiRequest<TimeSeriesResponse>('/forecast/timeseries', {
      method: 'GET',
      signal,
      params: { indicator, granularity, confidence },
      schema: timeSeriesResponseSchema,
    })
    return resp
  },

  /**
   * 获取指标对比数据（柱状图）。
   * api 模式调用后端 /forecast/indicator/:type，支持 signal 取消。
   */
  async getIndicatorComparison(
    indicator: string,
    time: string,
    confidence: number,
    signal?: AbortSignal
  ): Promise<IndicatorComparisonResponse> {
    if (_resolveSource(indicator) === 'static') {
      // static 模式无 indicator/:type 端点，回退到单指标文件取指定时间点的值
      const series = await _fetchStatic(indicator)
      const ports: IndicatorComparisonResponse['ports'] = {}
      Object.entries(series.data).forEach(([portId, portSeries]) => {
        const allData = [...(portSeries.historical || []), ...(portSeries.forecast || [])]
        const point = allData.find((d) => d.time === time || d.time.startsWith(time))
        ports[portId] = {
          portName: portId,
          value: point?.value ?? null,
          historical: portSeries.historical || [],
          forecast: portSeries.forecast || [],
        }
      })
      return { indicator: series.indicator, unit: series.unit, ports }
    }
    // api 模式
    const { apiRequest } = useApiRequest()
    const resp = await apiRequest<IndicatorComparisonResponse>(`/forecast/indicator/${indicator}`, {
      method: 'GET',
      signal,
      params: { time, confidence },
      schema: indicatorComparisonResponseSchema,
    })
    return resp
  },

  /**
   * 获取地图热力图数据（FeatureCollection）。
   * api 模式调用后端 /forecast/map，支持 signal 取消。
   * static 模式读取 indicator JSON 的 spatial 字段并按 time 插值。
   */
  async getMapData(
    indicator: string,
    time: string,
    confidence: number,
    signal?: AbortSignal
  ): Promise<ForecastMapData> {
    if (_resolveSource(indicator) === 'static') {
      const url = `${STATIC_BASE}/${indicator}.json`
      // 静态资源 fetch 收口 loadStatic（透传 signal 支持事务取消）
      const file = await loadStatic<_StaticForecastFile>(url, { signal })
      const features: ForecastMapData['features'] = []
      for (const portId in file.data) {
        const port = file.data[portId]
        if (!port.spatial?.features) continue
        for (const f of port.spatial.features) {
          const value = _lookupValue(f.properties.values, time)
          features.push({
            type: 'Feature',
            geometry: f.geometry,
            properties: {
              portId: f.properties.portId,
              portName: f.properties.portName,
              value: value ?? 0,
              reliability: confidence,
            },
          })
        }
      }
      return {
        indicator: file.indicator,
        unit: file.unit,
        time,
        type: 'FeatureCollection',
        features,
      }
    }
    // api 模式
    const { apiRequest } = useApiRequest()
    const resp = await apiRequest<ForecastMapData>('/forecast/map', {
      method: 'GET',
      signal,
      params: { indicator, time, confidence },
      schema: forecastMapDataSchema,
    })
    return resp
  },

  /**
   * 获取单指标完整数据（static 模式专用，api 模式走 getTimeSeries）。
   * 保留供需要原始 ForecastSeries 结构的调用方使用。
   * 预留未接入：无生产调用方（仅有 forecastAdapter.test.ts 覆盖），保留作预留 API
   */
  async getIndicatorData(indicator: string): Promise<ForecastSeries> {
    if (_resolveSource(indicator) === 'static') {
      return _fetchStatic(indicator)
    }
    // api 模式无单文件端点，走 timeseries 并取第一个 series
    const ts = await this.getTimeSeries(indicator, 'month', 1.0)
    // 组装为 ForecastSeries 结构（近似）
    const data: Record<
      string,
      {
        historical: Array<{ time: string; value: number; type: 'historical' | 'forecast' }>
        forecast?: Array<{ time: string; value: number; type: 'historical' | 'forecast' }>
      }
    > = {}
    ts.series.forEach((s) => {
      const historical = s.data.filter((d) => d.type === 'historical')
      const forecast = s.data.filter((d) => d.type === 'forecast')
      data[s.portId] = { historical, forecast }
    })
    return { indicator: ts.indicator, unit: ts.unit, data }
  },

  // 预留未接入：无生产调用方（仅有 forecastAdapter.test.ts 覆盖），保留作预留 API
  async getAvailableIndicators(): Promise<ForecastIndicatorIndex> {
    if (resolveDataSource(ADAPTER_NAME) === 'static') {
      return _fetchStaticIndex()
    }
    // api 模式调 /forecast/overview
    const { apiRequest } = useApiRequest()
    const resp = await apiRequest<ForecastIndicatorIndex>('/forecast/overview', {
      method: 'GET',
      schema: forecastIndicatorIndexSchema,
    })
    return resp
  },
}

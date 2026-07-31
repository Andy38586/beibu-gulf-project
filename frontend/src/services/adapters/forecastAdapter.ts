/**
 * Forecast Data Adapter
 *
 * 职责：隔离预测分析业务层与数据源。
 *
 * 接入状态（2026-07-29）：
 * - ForecastPage 已通过 useForecastRequest → forecastAdapter.getTimeSeries / getIndicatorComparison 取数，
 *   不再直接调 useApiRequest，Adapter 模式一致性已恢复。
 * - mock 模式：读取 public/data/forecast/*.json 静态 fixture。
 * - api 模式：通过 useApiRequest 调用后端 /forecast/timeseries、/forecast/indicator/:type，
 *   支持事务取消（AbortSignal 透传）。
 *
 * 注意：ForecastIndicatorIndex.indicators 当前为字符串数组（对齐 index.json 的 metadata.indicators），
 * 非 Array<{key,label,unit}>。后者是早期设计稿的设想，与真实 mock 不符，已校正。
 */

import { useApiRequest } from '@/shared/composables/useApiRequest'
import { logger } from '@/shared/utils/logger'
import type { ForecastSeries } from '@/types/api/forecast'

/**
 * 指标索引（对应 public/data/forecast/index.json 的结构）。
 *
 * 注意：mock 文件的 metadata.indicators 是字符串数组（如 ["throughput","berth"]），
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
 * Mock JSON 原始结构（比 ForecastSeries 多 spatial 字段）。
 * ForecastSeries 类型仅描述 historical/forecast，不含 spatial；
 * 此处为 adapter 内部使用的真实 mock 文件形状。
 */
interface _MockForecastFile {
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

const MOCK_BASE = '/data/forecast'

/** 在 mock values 字典中查找指定时间的值，找不到时取最近的前一个时间点 */
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

let _dataSource: 'mock' | 'api' = 'mock'

async function _fetchMock(indicator: string): Promise<ForecastSeries> {
  const url = `${MOCK_BASE}/${indicator}.json`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`[ForecastAdapter] Mock 数据加载失败: ${indicator} (HTTP ${res.status})`)
  }
  return (await res.json()) as ForecastSeries
}

async function _fetchMockIndex(): Promise<ForecastIndicatorIndex> {
  const url = `${MOCK_BASE}/index.json`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`[ForecastAdapter] Mock 指标索引加载失败 (HTTP ${res.status})`)
  }
  return (await res.json()) as ForecastIndicatorIndex
}

/** 后端统一响应包裹 */
interface ApiEnvelope<T> {
  code: number
  data: T
}

export const forecastAdapter = {
  get dataSource(): string {
    return _dataSource
  },

  setDataSource(mode: 'mock' | 'api'): void {
    if (mode !== 'mock' && mode !== 'api') {
      throw new Error(`[ForecastAdapter] 无效的数据源模式: ${mode}，仅支持 'mock' 或 'api'`)
    }
    _dataSource = mode
    logger.info(`[ForecastAdapter] 数据源切换为: ${mode}`)
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
    if (_dataSource === 'mock') {
      // mock 模式无 timeseries 端点，回退到单指标文件并组装为 series 结构
      const series = await _fetchMock(indicator)
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
    const path = `/forecast/timeseries?indicator=${indicator}&granularity=${granularity}&confidence=${confidence}`
    const resp = await apiRequest<ApiEnvelope<TimeSeriesResponse>>(path, { method: 'GET', signal })
    return resp.data
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
    if (_dataSource === 'mock') {
      // mock 模式无 indicator/:type 端点，回退到单指标文件取指定时间点的值
      const series = await _fetchMock(indicator)
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
    const path = `/forecast/indicator/${indicator}?time=${time}&confidence=${confidence}`
    const resp = await apiRequest<ApiEnvelope<IndicatorComparisonResponse>>(path, {
      method: 'GET',
      signal,
    })
    return resp.data
  },

  /**
   * 获取地图热力图数据（FeatureCollection）。
   * api 模式调用后端 /forecast/map，支持 signal 取消。
   * mock 模式读取 indicator JSON 的 spatial 字段并按 time 插值。
   */
  async getMapData(
    indicator: string,
    time: string,
    confidence: number,
    signal?: AbortSignal
  ): Promise<ForecastMapData> {
    if (_dataSource === 'mock') {
      const url = `${MOCK_BASE}/${indicator}.json`
      const res = await fetch(url, { signal })
      if (!res.ok) {
        throw new Error(
          `[ForecastAdapter] Mock 地图数据加载失败: ${indicator} (HTTP ${res.status})`
        )
      }
      const file = (await res.json()) as _MockForecastFile
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
    const path = `/forecast/map?indicator=${indicator}&time=${time}&confidence=${confidence}`
    const resp = await apiRequest<ApiEnvelope<ForecastMapData>>(path, { method: 'GET', signal })
    return resp.data
  },

  /**
   * 获取单指标完整数据（mock 模式专用，api 模式走 getTimeSeries）。
   * 保留供需要原始 ForecastSeries 结构的调用方使用。
   */
  async getIndicatorData(indicator: string): Promise<ForecastSeries> {
    if (_dataSource === 'mock') {
      return _fetchMock(indicator)
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

  async getAvailableIndicators(): Promise<ForecastIndicatorIndex> {
    if (_dataSource === 'mock') {
      return _fetchMockIndex()
    }
    // api 模式调 /forecast/overview
    const { apiRequest } = useApiRequest()
    const resp = await apiRequest<ApiEnvelope<ForecastIndicatorIndex>>('/forecast/overview', {
      method: 'GET',
    })
    return resp.data
  },
}

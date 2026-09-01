import { Injectable, Logger } from '@nestjs/common'

import { createReadCache } from '../../common/cache/read-cache'
import { BusinessError, ErrorCode } from '../../common/errors/business-error'
import { DataFilesService } from '../../infra/files/data-files.service'

import type {
  EngineMetadata,
  ForecastPoint,
  HistoricalPoint,
  SpatialFeature,
} from './forecast-engine'
import { computeForecast, generateSpatialValues } from './forecast-engine'
import { getModelForecast } from './model-loader'

// 预测服务（逐行等价移植 backend/services/forecastService.js）：
// 指标白名单拒绝路径遍历；合成指标文件自带 forecast；cargo/container 走模型产物
//（固定基线 scenarioLevel 1.0，缺失降级引擎）；引擎结果缓存 TTL+LRU 上限防枚举放大

// 指标白名单：拒绝路径遍历（..）与非法指标名——路由公开不代表接受任意输入
const ALLOWED_INDICATORS = new Set(['cargo', 'container', 'berth', 'traffic'])

// 合成指标（berth/traffic）：示意性合成数据，文件自带 historical+forecast，不走预测模型
const SYNTHETIC_INDICATORS = new Set(['berth', 'traffic'])

// 走吞吐量模型产物的指标：模型为固定基线（scenarioLevel 恒 1.0）；产物缺失时降级引擎
const MODEL_INDICATORS = new Set(['cargo', 'container'])

const MAX_CACHE_SIZE = 100

const logger = new Logger('ForecastService')

function validateIndicator(indicator: unknown): asserts indicator is string {
  if (!indicator || typeof indicator !== 'string') {
    throw new BusinessError(ErrorCode.INVALID_PARAMS, '缺少参数: indicator')
  }
  if (indicator.includes('..')) {
    throw new BusinessError(ErrorCode.INVALID_PARAMS, '非法的指标参数')
  }
  if (!ALLOWED_INDICATORS.has(indicator)) {
    throw new BusinessError(ErrorCode.NOT_FOUND, `未知指标: ${indicator}`)
  }
}

interface PortSourceData {
  historical?: HistoricalPoint[]
  forecast?: ForecastPoint[]
  spatial?: { features?: SpatialFeature[] } | null
}

interface IndicatorFileShape {
  indicator: string
  unit: string
  data: Record<string, PortSourceData>
}

interface ComputedPort {
  portName: string
  historical: HistoricalPoint[]
  forecast: ForecastPoint[]
  spatial: { features?: SpatialFeature[] } | null
  metadata: Record<string, unknown> | null
}

@Injectable()
export class ForecastService {
  // 引擎结果缓存（TTL + LRU 上限）：上限防枚举 confidence 造成内存放大
  private readonly engineCache = createReadCache<Record<string, unknown>>({
    maxSize: MAX_CACHE_SIZE,
  })

  constructor(private readonly dataFiles: DataFilesService) {}

  // 预测指标索引（forecast/index.json），对齐 Express forecastRepository.readForecastIndex
  readIndex(): Promise<unknown> {
    return this.dataFiles.read('forecast/index.json')
  }

  // 读盘统一走 DataFilesService（createReadCache 语义：TTL + LRU）
  private async readDataFile(filename: string): Promise<IndicatorFileShape> {
    try {
      return (await this.dataFiles.read(`forecast/${filename}`)) as IndicatorFileShape
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') {
        throw new BusinessError(
          ErrorCode.NOT_FOUND,
          `指标数据文件不存在: ${filename.replace('.json', '')}`
        )
      }
      throw err
    }
  }

  private getCacheKey(indicator: string, scenarioLevel: number): string {
    // cargo 为模型固定基线（scenarioLevel 恒 1.0），键忽略 scenarioLevel（同结果多键=缓存冗余）
    return MODEL_INDICATORS.has(indicator) ? indicator : `${indicator}:${scenarioLevel}`
  }

  private async getOrComputeForecast(
    indicator: string,
    scenarioLevel: number
  ): Promise<{ indicator: string; unit: string; ports: Record<string, ComputedPort> }> {
    validateIndicator(indicator)
    const key = this.getCacheKey(indicator, scenarioLevel)
    const hit = this.engineCache.get(key)
    if (hit !== undefined)
      return hit as { indicator: string; unit: string; ports: Record<string, ComputedPort> }

    const data = await this.readDataFile(indicator + '.json')
    const result: { indicator: string; unit: string; ports: Record<string, ComputedPort> } = {
      indicator: data.indicator,
      unit: data.unit,
      ports: {},
    }

    for (const portId in data.data) {
      const portData = data.data[portId]
      const historical = portData.historical
      const spatial = portData.spatial
      const portName = spatial?.features?.[0]?.properties?.portName || portId

      let forecast: ForecastPoint[] | null = null
      let metadata: Record<string, unknown> | null = null

      if (MODEL_INDICATORS.has(indicator)) {
        // cargo/container 走吞吐量模型产物（固定基线，与历史重叠月份丢弃、半年点插值补齐）
        const lastTime = historical?.[historical.length - 1]?.time
        const modelResult = await getModelForecast(this.dataFiles, portId, lastTime, indicator)
        if (modelResult) {
          forecast = modelResult.forecast
          metadata = { ...modelResult.metadata, scenarioLevel: 1.0 }
        } else {
          logger.warn(`${indicator}/${portId} 模型产物不可用，降级趋势外推`)
          const engineResult = computeForecast(historical ?? null, 1.0)
          // 历史数据不足（防御路径）错误走业务错误通道（R7），不塞进成功信封
          if (engineResult.metadata?.error) {
            throw new BusinessError(ErrorCode.ANALYSIS_FAILED, engineResult.metadata.error)
          }
          forecast = engineResult.forecast
          metadata = engineResult.metadata as Record<string, unknown>
        }
      } else if (SYNTHETIC_INDICATORS.has(indicator)) {
        // 合成指标：文件自带 forecast 直接透传
        forecast = portData.forecast || []
      } else {
        // 防御兜底（当前无真实指标走此路）：趋势外推引擎演算
        const engineResult = computeForecast(historical ?? null, scenarioLevel)
        if (engineResult.metadata?.error) {
          throw new BusinessError(ErrorCode.ANALYSIS_FAILED, engineResult.metadata.error)
        }
        forecast = engineResult.forecast
        metadata = engineResult.metadata as Record<string, unknown>
      }

      result.ports[portId] = {
        portName,
        historical: historical ?? [],
        forecast: forecast ?? [],
        spatial: spatial ?? null,
        metadata,
      }
    }

    this.engineCache.set(key, result as unknown as Record<string, unknown>)
    return result
  }

  async getMapData(
    indicator: string,
    time: string,
    scenarioLevel = 1.0
  ): Promise<Record<string, unknown>> {
    const computed = await this.getOrComputeForecast(indicator, scenarioLevel)
    const features: unknown[] = []

    for (const portId in computed.ports) {
      const port = computed.ports[portId]
      const spatial = port.spatial
      if (!spatial?.features) continue

      const spatialValues = generateSpatialValues(
        port.historical,
        port.forecast,
        time,
        spatial.features
      )

      for (const feature of spatialValues) {
        features.push({
          type: 'Feature',
          geometry: feature.geometry,
          properties: {
            portId: feature.properties.portId,
            portName: feature.properties.portName,
            value: feature.properties.value,
            reliability: feature.properties.reliability,
          },
        })
      }
    }

    return {
      indicator: computed.indicator,
      unit: computed.unit,
      time,
      type: 'FeatureCollection',
      features,
    }
  }

  async getPortData(
    portId: string,
    indicator?: string,
    start?: string,
    end?: string
  ): Promise<Record<string, unknown>> {
    const indicators = indicator ? [indicator] : ['cargo', 'container']
    const result: Record<string, unknown> = { portId, portName: '', indicators: {} }
    const indicatorsOut = result.indicators as Record<string, unknown>

    for (const ind of indicators) {
      const computed = await this.getOrComputeForecast(ind, 1.0)
      const port = computed.ports[portId]
      if (!port) continue

      if (!result.portName) result.portName = port.portName

      let historical = port.historical
      let forecast = port.forecast
      if (start) {
        historical = historical.filter((d) => d.time >= start)
        forecast = forecast.filter((d) => d.time >= start)
      }
      if (end) {
        historical = historical.filter((d) => d.time <= end)
        forecast = forecast.filter((d) => d.time <= end)
      }

      indicatorsOut[ind] = { unit: computed.unit, historical, forecast }
    }

    return result
  }

  async getIndicatorData(
    type: string,
    time: string | undefined,
    portId: string | undefined,
    scenarioLevel = 1.0
  ): Promise<Record<string, unknown>> {
    const computed = await this.getOrComputeForecast(type, scenarioLevel)
    const result: Record<string, unknown> = {
      indicator: computed.indicator,
      unit: computed.unit,
      ports: {},
    }
    const portsOut = result.ports as Record<string, unknown>
    const ports = portId ? [portId] : Object.keys(computed.ports)

    for (const pid of ports) {
      const port = computed.ports[pid]
      if (!port) continue
      let value: number | null = null
      if (time) {
        const point =
          port.historical.find((d) => d.time === time) || port.forecast.find((d) => d.time === time)
        value = point?.value ?? null // 合法 0 值不被 || 当缺失
      }
      portsOut[pid] = {
        portName: port.portName,
        value,
        historical: port.historical,
        forecast: port.forecast,
      }
    }

    return result
  }

  async getTimeSeriesData(
    indicator: string,
    portId: string | undefined,
    start: string | undefined,
    end: string | undefined,
    granularity: string | undefined,
    scenarioLevel = 1.0
  ): Promise<Record<string, unknown>> {
    const computed = await this.getOrComputeForecast(indicator, scenarioLevel)
    const ports = portId ? [portId] : Object.keys(computed.ports)
    const series: unknown[] = []

    for (const pid of ports) {
      const port = computed.ports[pid]
      if (!port) continue
      let allData: Array<HistoricalPoint | ForecastPoint> = [...port.historical, ...port.forecast]
      if (start) allData = allData.filter((d) => d.time >= start)
      if (end) allData = allData.filter((d) => d.time <= end)

      if (granularity === 'year') {
        const yearly: Record<string, { time: string; value: number; count: number; type: string }> =
          {}
        allData.forEach((d) => {
          const y = d.time.split('-')[0]
          if (!yearly[y]) yearly[y] = { time: y, value: 0, count: 0, type: d.type ?? 'historical' }
          yearly[y].value += d.value
          yearly[y].count++
          // 年内可能跨历史/预测（当前年），type 取最后一条为准，使含预测的年标记为 forecast
          yearly[y].type = d.type ?? 'historical'
        })
        allData = Object.values(yearly).map((d) => ({
          time: d.time,
          value: Math.round(d.value / d.count),
          type: d.type,
        }))
      }

      series.push({ portId: pid, portName: port.portName, data: allData })
    }

    return {
      indicator: computed.indicator,
      unit: computed.unit,
      granularity: granularity || 'month',
      series,
    }
  }

  /** 测试钩子：清空引擎缓存（对齐 Express 侧 resetModules 清缓存模式） */
  _clearEngineCacheForTest(): void {
    this.engineCache.clear()
  }
}

export type { EngineMetadata }

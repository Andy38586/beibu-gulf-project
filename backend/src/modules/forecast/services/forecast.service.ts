import { Injectable, Logger } from '@nestjs/common'

import { createReadCache } from '../../../common/cache/read-cache'
import { BusinessError, ErrorCode, missingParamError } from '../../../common/errors/business-error'
import { DataFilesService } from '../../../infra/files/data-files.service'

import type { ForecastPoint, HistoricalPoint, SpatialFeature } from './forecast-engine'
import { computeForecast, generateSpatialValues } from './forecast-engine'
import { getModelForecast } from './model-loader'
import { applyCanalScenario, type ScenarioId, scenarioLabel } from './scenario.service'

// 预测服务（逐行等价移植 backend/services/forecastService.js）：
// 指标白名单拒绝路径遍历；activity 文件自带完整 forecast 直接透传；cargo/container 走模型产物
//（固定基线 scenarioLevel 1.0，缺失降级引擎）；引擎结果缓存 TTL+LRU 上限防枚举放大

// 指标白名单：拒绝路径遍历（..）与非法指标名——路由公开不代表接受任意输入。
// berth/traffic 为纯合成指标：2026-09-08 下架消费，2026-10-07 删除数据文件（防 mock 坐标回流）
/**
 * 主指标名（'cargo'）。2026-10-13 收口（B2）：原在文件内散写五处（白名单/模型白名单/
 * 缓存键拼装/运河场景判定/默认指标数组）⇒ 改指标名必漏。'container'/'activity' 同理，
 * 但当前无同名语义分支，暂不提升。
 */
const CARGO_INDICATOR = 'cargo'

const ALLOWED_INDICATORS = new Set([CARGO_INDICATOR, 'container', 'activity'])

// 文件自带完整 forecast 直接透传的指标（实为真数据派生产物，非合成）：
// activity=港口吞吐活跃度（cargo 官方真吞吐量基期归一指数，见 tools/forecast/derive-activity.mjs）
const FILE_FORECAST_INDICATORS = new Set(['activity'])

// 走吞吐量模型产物的指标：模型为固定基线（scenarioLevel 恒 1.0）；产物缺失时降级引擎
const MODEL_INDICATORS = new Set([CARGO_INDICATOR, 'container'])

const MAX_CACHE_SIZE = 100

const logger = new Logger('ForecastService')

function validateIndicator(indicator: unknown): asserts indicator is string {
  if (!indicator || typeof indicator !== 'string') {
    throw missingParamError('indicator')
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

/**
 * getOrComputeForecast 的返回形状（= engineCache 的 value 形状，含缓存命中直出路径）。
 * 2026-10-25 收口：原在方法签名/cache 断言/局部变量注解三处各写一遍同一 5 字段字面量类型，
 * 改一处必漏两处（与 B2 指标名散写同类缺陷）⇒ 提为命名类型，三处共用。
 *
 * ⚠️ 必须是 type 别名而非 interface：缓存命中处要 `hit as ComputedForecast`
 * （hit 为 Record<string, unknown>）。type 别名带隐式索引签名 ⇒ 单次断言合法；
 * 写成 interface 则 TS2352（无隐式索引签名），被迫降级 `as unknown as` 反而更松。
 */
type ComputedForecast = {
  indicator: string
  unit: string
  canalScenario: ScenarioId
  ports: Record<string, ComputedPort>
}

/**
 * 预测数据来源标记（P1-1 降级可观测）：调用方可见的**唯一事实**，logger 只是旁证。
 * - 'model'：走吞吐量模型产物（getModelForecast 命中）
 * - 'engine-fallback'：模型产物不可用，降级 computeForecast 趋势外推
 *
 * 可选：activity 等「文件自带真数据」指标既非模型产物也非降级，不打标记——
 * 保持旧响应形状，也不把真数据误标成降级。
 */
export type ForecastDataSource = 'model' | 'engine-fallback'

/** metadata 是宽类型（模型产物字段随产物演进），取标记处收窄 */
function dataSourceOf(metadata: Record<string, unknown> | null): ForecastDataSource | undefined {
  const value = metadata?.dataSource
  return value === 'model' || value === 'engine-fallback' ? value : undefined
}

/**
 * 响应级聚合：任一端口降级 ⇒ 'engine-fallback'（部分降级同样必须对外可见）；
 * 全部走模型 ⇒ 'model'；无任何标记（activity 文件透传）⇒ undefined（响应不写该字段）。
 */
function aggregateDataSource(
  sources: Array<ForecastDataSource | undefined>
): ForecastDataSource | undefined {
  if (sources.includes('engine-fallback')) return 'engine-fallback'
  return sources.includes('model') ? 'model' : undefined
}

/** metadata 打标记：4 个预测端点共用，避免同一展开式手抄四份（P1-1） */
function withDataSource(
  metadata: Record<string, unknown> | null,
  dataSource: ForecastDataSource
): Record<string, unknown> {
  return { ...(metadata ?? {}), dataSource }
}

/** 响应级标记：无标记（旧/文件透传）时返回空对象，保持响应形状 */
function sourceMetadata(dataSource: ForecastDataSource | undefined): {
  metadata?: { dataSource: ForecastDataSource }
} {
  return dataSource ? { metadata: { dataSource } } : {}
}

/** 收集端口标记：无 port.metadata 的端口不参与聚合 */
function pushPortSource(
  list: Array<ForecastDataSource | undefined>,
  metadata: Record<string, unknown> | null
): void {
  const source = dataSourceOf(metadata)
  if (source) list.push(source)
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

  private getCacheKey(indicator: string, scenarioLevel: number, canalScenario: ScenarioId): string {
    // 仅 cargo 有运河文献锚点（04-B10）⇒ 键随情景变化只需覆盖 cargo；其余指标情景恒
    // baseline（上游守卫拒绝），键保持 scenarioLevel 原形
    return indicator === CARGO_INDICATOR
      ? `${indicator}:${canalScenario}`
      : `${indicator}:${scenarioLevel}`
  }

  private async getOrComputeForecast(
    indicator: string,
    scenarioLevel: number,
    canalScenario: ScenarioId = 'baseline'
  ): Promise<ComputedForecast> {
    validateIndicator(indicator)
    // 运河增量仅有货物吨口径的文献锚点（04-B10：不伪造参数）——非 cargo 组合显式拒绝。
    // 此前查 MODEL_INDICATORS（含 container）放行了无参数依据的集装箱情景预测：
    // 注释口径是 cargo-only 而实现放行两指标，且旧门控测试因 mock 缺 container.json
    // 以错误原因变绿（守卫可删而测试仍绿 = 假绿壳，F5 修复 + 变异取证）
    if (canalScenario !== 'baseline' && indicator !== CARGO_INDICATOR) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '运河情景仅支持 cargo 指标')
    }
    const key = this.getCacheKey(indicator, scenarioLevel, canalScenario)
    const hit = this.engineCache.get(key)
    if (hit !== undefined) return hit as ComputedForecast

    const data = await this.readDataFile(indicator + '.json')
    const result: ComputedForecast = {
      indicator: data.indicator,
      unit: data.unit,
      canalScenario,
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
          metadata = withDataSource({ ...modelResult.metadata, scenarioLevel: 1.0 }, 'model')
        } else {
          // 降级保留日志旁证，但对外事实只认 metadata.dataSource（P1-1）
          logger.warn(`${indicator}/${portId} 模型产物不可用，降级趋势外推`)
          const engineResult = computeForecast(historical ?? null, 1.0)
          // 历史数据不足（防御路径）错误走业务错误通道（R7），不塞进成功信封
          if (engineResult.metadata?.error) {
            throw new BusinessError(ErrorCode.ANALYSIS_FAILED, engineResult.metadata.error)
          }
          forecast = engineResult.forecast
          metadata = withDataSource(
            engineResult.metadata as Record<string, unknown>,
            'engine-fallback'
          )
        }
        // 运河情景叠加（只动预测段；历史段永不修改）——变换在缓存前执行，键已含情景
        if (canalScenario !== 'baseline') {
          forecast = applyCanalScenario(portId, forecast, canalScenario)
          metadata = {
            ...metadata,
            canalScenario,
            canalScenarioLabel: scenarioLabel(canalScenario),
          }
        }
      } else if (FILE_FORECAST_INDICATORS.has(indicator)) {
        // 文件自带完整 forecast（真数据派生产物，如 activity）直接透传
        forecast = portData.forecast || []
      } else {
        // 防御兜底（当前无真实指标走此路）：趋势外推引擎演算——同属降级，必须与模型缺失
        // 分支同一标记，否则「只标一处」会让该分支继续静默（P1-1 同族一次收全）
        const engineResult = computeForecast(historical ?? null, scenarioLevel)
        if (engineResult.metadata?.error) {
          throw new BusinessError(ErrorCode.ANALYSIS_FAILED, engineResult.metadata.error)
        }
        forecast = engineResult.forecast
        metadata = withDataSource(
          engineResult.metadata as Record<string, unknown>,
          'engine-fallback'
        )
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
    scenarioLevel = 1.0,
    canalScenario: ScenarioId = 'baseline'
  ): Promise<Record<string, unknown>> {
    const computed = await this.getOrComputeForecast(indicator, scenarioLevel, canalScenario)
    const features: unknown[] = []
    // 只统计真正产出图元的港口：无 spatial / 该时刻无值（0 图元）的港口不参与降级判定，
    // 否则会出现「看不见的港口降级把可见结果整体标红」
    const dataSources: Array<ForecastDataSource | undefined> = []

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
      if (spatialValues.length === 0) continue
      pushPortSource(dataSources, port.metadata)

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

    const dataSource = aggregateDataSource(dataSources)

    return {
      indicator: computed.indicator,
      unit: computed.unit,
      time,
      canalScenario: computed.canalScenario,
      type: 'FeatureCollection',
      features,
      // 可选字段：无标记（旧/文件透传路径）时不写，保持响应形状
      ...sourceMetadata(dataSource),
    }
  }

  async getPortData(
    portId: string,
    indicator?: string,
    start?: string,
    end?: string,
    canalScenario: ScenarioId = 'baseline'
  ): Promise<Record<string, unknown>> {
    const indicators = indicator ? [indicator] : [CARGO_INDICATOR, 'container']
    const result: Record<string, unknown> = { portId, portName: '', canalScenario, indicators: {} }
    const indicatorsOut = result.indicators as Record<string, unknown>
    // 多指标一次返回：逐指标收集该港口的标记，任一降级即整体标降级（P1-1）
    const dataSources: Array<ForecastDataSource | undefined> = []

    for (const ind of indicators) {
      const computed = await this.getOrComputeForecast(ind, 1.0, canalScenario)
      const port = computed.ports[portId]
      if (!port) continue
      pushPortSource(dataSources, port.metadata)

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

    const dataSource = aggregateDataSource(dataSources)

    return {
      ...result,
      // 可选字段：无标记时不写（保持旧响应形状）
      ...sourceMetadata(dataSource),
    }
  }

  async getIndicatorData(
    type: string,
    time: string | undefined,
    portId: string | undefined,
    scenarioLevel = 1.0,
    canalScenario: ScenarioId = 'baseline'
  ): Promise<Record<string, unknown>> {
    const computed = await this.getOrComputeForecast(type, scenarioLevel, canalScenario)
    const result: Record<string, unknown> = {
      indicator: computed.indicator,
      unit: computed.unit,
      canalScenario: computed.canalScenario,
      ports: {},
    }
    const portsOut = result.ports as Record<string, unknown>
    const ports = portId ? [portId] : Object.keys(computed.ports)
    // 只聚合**实际返回**的港口：portId 过滤后，未返回港口的降级不该污染本次响应（P1-1）
    const dataSources: Array<ForecastDataSource | undefined> = []

    for (const pid of ports) {
      const port = computed.ports[pid]
      if (!port) continue
      pushPortSource(dataSources, port.metadata)
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

    const dataSource = aggregateDataSource(dataSources)

    return {
      ...result,
      ...sourceMetadata(dataSource),
    }
  }

  async getTimeSeriesData(
    indicator: string,
    portId: string | undefined,
    start: string | undefined,
    end: string | undefined,
    granularity: string | undefined,
    scenarioLevel = 1.0,
    canalScenario: ScenarioId = 'baseline'
  ): Promise<Record<string, unknown>> {
    const computed = await this.getOrComputeForecast(indicator, scenarioLevel, canalScenario)
    const ports = portId ? [portId] : Object.keys(computed.ports)
    const series: unknown[] = []
    // 同 getIndicatorData：只聚合实际返回的港口（P1-1）
    const dataSources: Array<ForecastDataSource | undefined> = []

    for (const pid of ports) {
      const port = computed.ports[pid]
      if (!port) continue
      pushPortSource(dataSources, port.metadata)
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

    const dataSource = aggregateDataSource(dataSources)

    return {
      indicator: computed.indicator,
      unit: computed.unit,
      granularity: granularity || 'month',
      canalScenario: computed.canalScenario,
      series,
      ...sourceMetadata(dataSource),
    }
  }
}

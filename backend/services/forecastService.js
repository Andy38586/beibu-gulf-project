import { BusinessError, ErrorCode } from '../utils/BusinessError.js'
import { createReadCache } from '../utils/createReadCache.js'
import { logger } from '../utils/logger.js'
import { readStaticJson } from '../utils/readStaticJson.js'

import { computeForecast, generateSpatialValues } from './forecastEngine.js'
import { getModelForecast } from './modelLoader.js'

// 指标白名单：拒绝路径遍历（..）与非法指标名——路由公开不代表接受任意输入；
// berth/traffic 数据已从前端 fixture 收归后端，四指标统一走此入口
const ALLOWED_INDICATORS = new Set(['cargo', 'container', 'berth', 'traffic'])

// 合成指标（berth/traffic）：示意性合成数据，文件自带 historical+forecast，不走预测模型
const SYNTHETIC_INDICATORS = new Set(['berth', 'traffic'])

// 走吞吐量模型产物的指标：模型为固定基线（scenarioLevel 恒 1.0）；
// 产物缺失时降级 forecastEngine，接口不因模型文件问题中断
// 2026-08-29：container 接入（container_model.json，与 cargo 同方法同口径；
// 原恒增长率复利外推对集装箱月波动拟合弱，换模型链路）
const MODEL_INDICATORS = new Set(['cargo', 'container'])

const MAX_CACHE_SIZE = 100

function validateIndicator(indicator) {
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

// 读盘统一走 readStaticJson（createReadCache=读文件缓存工厂，TTL + LRU）
async function readDataFile(filename) {
  try {
    return await readStaticJson(`forecast/${filename}`)
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new BusinessError(
        ErrorCode.NOT_FOUND,
        `指标数据文件不存在: ${filename.replace('.json', '')}`
      )
    }
    throw err
  }
}

// 引擎结果缓存（createReadCache 读文件缓存工厂：TTL + LRU 上限）；
// 上限防枚举 confidence 造成内存放大，TTL 避免数据更新后返回陈旧预测
const engineCache = createReadCache({ maxSize: MAX_CACHE_SIZE })

function getCacheKey(indicator, scenarioLevel) {
  // 8-14：cargo 为模型固定基线（scenarioLevel 恒 1.0），前端传不同 confidence 时
  // 键不同但结果相同 → 缓存冗余（同结果多键）；模型指标键忽略 scenarioLevel
  return MODEL_INDICATORS.has(indicator) ? indicator : `${indicator}:${scenarioLevel}`
}

async function getOrComputeForecast(indicator, scenarioLevel) {
  validateIndicator(indicator)
  const key = getCacheKey(indicator, scenarioLevel)
  const hit = engineCache.get(key)
  if (hit !== undefined) return hit

  const data = await readDataFile(indicator + '.json')
  const result = { indicator: data.indicator, unit: data.unit, ports: {} }

  for (const portId in data.data) {
    const portData = data.data[portId]
    const historical = portData.historical
    const spatial = portData.spatial
    const portName = spatial?.features?.[0]?.properties?.portName || portId

    let forecast = null
    let metadata = null

    if (MODEL_INDICATORS.has(indicator)) {
      // cargo/container 走吞吐量模型产物（固定基线，与历史重叠月份丢弃、半年点插值补齐）
      const lastTime = historical?.[historical.length - 1]?.time
      const modelResult = await getModelForecast(portId, lastTime, indicator)
      if (modelResult) {
        forecast = modelResult.forecast
        metadata = { ...modelResult.metadata, scenarioLevel: 1.0 }
      } else {
        logger.warn(`[forecastService] ${indicator}/${portId} 模型产物不可用，降级趋势外推`)
        const engineResult = computeForecast(historical, 1.0)
        // 8-12：历史数据不足（防御路径）错误走业务错误通道（R7），不塞进成功信封
        if (engineResult.metadata?.error) {
          throw new BusinessError(ErrorCode.ANALYSIS_FAILED, engineResult.metadata.error)
        }
        forecast = engineResult.forecast
        metadata = engineResult.metadata
      }
    } else if (SYNTHETIC_INDICATORS.has(indicator)) {
      // 合成指标：文件自带 forecast 直接透传
      forecast = portData.forecast || []
    } else {
      // 防御兜底（当前无真实指标走此路）：趋势外推引擎演算
      const engineResult = computeForecast(historical, scenarioLevel)
      // 8-12：同上，错误不塞成功信封
      if (engineResult.metadata?.error) {
        throw new BusinessError(ErrorCode.ANALYSIS_FAILED, engineResult.metadata.error)
      }
      forecast = engineResult.forecast
      metadata = engineResult.metadata
    }

    result.ports[portId] = {
      portName,
      historical,
      forecast,
      spatial,
      metadata,
    }
  }

  engineCache.set(key, result)
  return result
}

export async function getMapData(indicator, time, scenarioLevel = 1.0) {
  const computed = await getOrComputeForecast(indicator, scenarioLevel)
  const features = []

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

export async function getPortData(portId, indicator, start, end) {
  const indicators = indicator ? [indicator] : ['cargo', 'container']
  const result = { portId, portName: '', indicators: {} }

  for (const ind of indicators) {
    const computed = await getOrComputeForecast(ind, 1.0)
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

    result.indicators[ind] = { unit: computed.unit, historical, forecast }
  }

  return result
}

export async function getIndicatorData(type, time, portId, scenarioLevel = 1.0) {
  const computed = await getOrComputeForecast(type, scenarioLevel)
  const result = { indicator: computed.indicator, unit: computed.unit, ports: {} }
  const ports = portId ? [portId] : Object.keys(computed.ports)

  for (const pid of ports) {
    const port = computed.ports[pid]
    if (!port) continue
    let value = null
    if (time) {
      const point =
        port.historical.find((d) => d.time === time) || port.forecast.find((d) => d.time === time)
      value = point?.value ?? null // 合法 0 值不被 || 当缺失
    }
    result.ports[pid] = {
      portName: port.portName,
      value,
      historical: port.historical,
      forecast: port.forecast,
    }
  }

  return result
}

export async function getTimeSeriesData(
  indicator,
  portId,
  start,
  end,
  granularity,
  scenarioLevel = 1.0
) {
  const computed = await getOrComputeForecast(indicator, scenarioLevel)
  const ports = portId ? [portId] : Object.keys(computed.ports)
  const series = []

  for (const pid of ports) {
    const port = computed.ports[pid]
    if (!port) continue
    let allData = [...port.historical, ...port.forecast]
    if (start) allData = allData.filter((d) => d.time >= start)
    if (end) allData = allData.filter((d) => d.time <= end)

    if (granularity === 'year') {
      const yearly = {}
      allData.forEach((d) => {
        const y = d.time.split('-')[0]
        if (!yearly[y]) yearly[y] = { time: y, value: 0, count: 0, type: d.type }
        yearly[y].value += d.value
        yearly[y].count++
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

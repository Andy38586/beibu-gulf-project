import { computeForecast, generateSpatialValues } from './forecastEngine.js'
import { createReadCache } from '../utils/createReadCache.js'
import { readStaticJson } from '../utils/readStaticJson.js'
import { BusinessError, ErrorCode } from '../utils/BusinessError.js'

// 指标白名单——仅允许 index.json 中声明过的合法指标，
// 拒绝路径遍历（..）及非法指标名。forecast 路由保持公开（稳定设计决策），
// 但不代表接受任意输入。
// 2026-08-08 数据搬后端：berth/traffic 由前端静态 fixture 移入 backend/data/forecast/，
// 与 cargo/container 统一走后端接口（前端 INDICATOR_SOURCE 硬编码已移除）。
const ALLOWED_INDICATORS = new Set(['cargo', 'container', 'berth', 'traffic'])

// 合成（非实测）指标：berth（泊位利用率）/ traffic（船舶流量）为示意性合成数据，
// 数据文件自带 historical+forecast，不走吞吐量预测模型（throughput 模型仅适用
// cargo/container 吞吐量指标）；与数据文件 metadata.source: 'synthetic' 对应。
const SYNTHETIC_INDICATORS = new Set(['berth', 'traffic'])

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

// 2026-08-08：读文件逻辑收敛到 utils/readStaticJson（数据流收口②，TTL+LRU 缓存同源）。
// 文件级缓存与下方 engineCache 同为 createReadCache 语义，数据更新受 TTL 约束一致。
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

// 缓存引擎计算结果，场景参数变化时失效。
// 统一只读缓存（createReadCache：TTL + LRU 上限,数据流收口②）。
// 上限防匿名攻击者枚举 confidence 制造内存放大；TTL 避免 data/forecast/*.json
// 更新后缓存永不失效（返回陈旧预测）。上限值见顶部 MAX_CACHE_SIZE。
const engineCache = createReadCache({ maxSize: MAX_CACHE_SIZE })

function getCacheKey(indicator, scenarioLevel) {
  return `${indicator}:${scenarioLevel}`
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

    // 合成指标（berth/traffic）：文件自带 forecast 直接透传，不走吞吐量模型
    // （见顶部 SYNTHETIC_INDICATORS 说明）；真实指标（cargo/container）由模型演算。
    const engineResult = SYNTHETIC_INDICATORS.has(indicator)
      ? null
      : computeForecast(historical, scenarioLevel)

    result.ports[portId] = {
      portName,
      historical,
      forecast: engineResult ? engineResult.forecast : portData.forecast || [],
      spatial,
      metadata: engineResult?.metadata,
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
      value = point?.value || null
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

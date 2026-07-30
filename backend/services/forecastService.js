import { readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { computeForecast, generateSpatialValues } from './forecastEngine.js'
import { BusinessError, ErrorCode } from '../utils/BusinessError.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '../data/forecast')

// @arch-note SEC-013: 指标白名单——仅允许 index.json 中声明过的合法指标，
// 拒绝路径遍历（..）及非法指标名。forecast 路由保持公开（稳定设计决策），
// 但不代表接受任意输入。
const ALLOWED_INDICATORS = new Set(['throughput', 'berth', 'traffic', 'pressure', 'development'])

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

async function readDataFile(filename) {
  try {
    return JSON.parse(await readFile(join(DATA_DIR, filename), 'utf-8'))
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new BusinessError(ErrorCode.NOT_FOUND, `指标数据文件不存在: ${filename.replace('.json', '')}`)
    }
    throw err
  }
}

// @arch-note SEC-014: 缓存引擎计算结果，场景参数变化时失效。
// 加 MAX_CACHE_SIZE 上限防止匿名攻击者枚举 confidence 制造内存放大。
const engineCache = new Map()

function getCacheKey(indicator, scenarioLevel) {
  return `${indicator}:${scenarioLevel}`
}

function _evictOldest() {
  const firstKey = engineCache.keys().next().value
  if (firstKey) engineCache.delete(firstKey)
}

async function getOrComputeForecast(indicator, scenarioLevel) {
  validateIndicator(indicator)
  const key = getCacheKey(indicator, scenarioLevel)
  if (engineCache.has(key)) return engineCache.get(key)

  const data = await readDataFile(indicator + '.json')
  const result = { indicator: data.indicator, unit: data.unit, ports: {} }

  for (const portId in data.data) {
    const portData = data.data[portId]
    const historical = portData.historical
    const spatial = portData.spatial
    const portName = spatial?.features?.[0]?.properties?.portName || portId

    const engineResult = computeForecast(historical, scenarioLevel)

    result.ports[portId] = {
      portName,
      historical,
      forecast: engineResult.forecast,
      spatial,
      metadata: engineResult.metadata,
    }
  }

  // 缓存上限保护
  if (engineCache.size >= MAX_CACHE_SIZE) {
    _evictOldest()
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
  const indicators = indicator ? [indicator] : ['throughput', 'berth', 'traffic', 'pressure']
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

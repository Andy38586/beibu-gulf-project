import {
  getIndicatorData as queryIndicator,
  getMapData,
  getPortData,
  getTimeSeriesData as queryTimeSeries,
} from '../services/forecastService.js'
import { BusinessError, ErrorCode } from '../utils/BusinessError.js'
import { readStaticJson } from '../utils/readStaticJson.js'
import { sendSuccess } from '../utils/response.js'

/** 情景系数收口：非有限/≤0 回退 1.0，上限 2——避免异常值经 Math.pow 产出 Infinity/NaN */
function parseConfidence(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 1.0
  return Math.min(n, 2)
}

export async function getForecastOverview(req, res, next) {
  try {
    // 读盘统一走 readStaticJson（TTL + LRU 缓存）
    const data = await readStaticJson('forecast/index.json')
    sendSuccess(res, data)
  } catch (error) {
    next(error)
  }
}

export async function getForecastMapData(req, res, next) {
  try {
    const { indicator, time, confidence } = req.query
    if (!indicator || !time) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '缺少参数: indicator, time')
    }
    const data = await getMapData(indicator, time, parseConfidence(confidence))
    sendSuccess(res, data)
  } catch (error) {
    next(error)
  }
}

export async function getPortForecast(req, res, next) {
  try {
    const { portId } = req.params
    const { indicator, start, end } = req.query
    const data = await getPortData(portId, indicator, start, end)
    sendSuccess(res, data)
  } catch (error) {
    next(error)
  }
}

export async function getIndicatorData(req, res, next) {
  try {
    const { type } = req.params
    const { time, portId, confidence } = req.query
    const data = await queryIndicator(type, time, portId, parseConfidence(confidence))
    sendSuccess(res, data)
  } catch (error) {
    next(error)
  }
}

export async function getTimeSeriesData(req, res, next) {
  try {
    const { indicator, portId, start, end, granularity, confidence } = req.query
    const data = await queryTimeSeries(
      indicator,
      portId,
      start,
      end,
      granularity,
      parseConfidence(confidence)
    )
    sendSuccess(res, data)
  } catch (error) {
    next(error)
  }
}

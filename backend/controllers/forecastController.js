import {
  getIndicatorData as queryIndicator,
  getMapData,
  getPortData,
  getTimeSeriesData as queryTimeSeries,
} from '../services/forecastService.js'
import { BusinessError, ErrorCode } from '../utils/BusinessError.js'
import { readStaticJson } from '../utils/readStaticJson.js'
import { sendSuccess } from '../utils/response.js'

/**
 * 情景系数（confidence）收口校验。
 * 原 `Number(confidence) || 1.0` 对 0/-5/Infinity/NaN 透传异常值，
 * 引擎 Math.pow 产出 Infinity/NaN → JSON 序列化 null。
 * 此处统一钳制：非有限/≤0 → 1.0；上限 2（合理情景系数范围）。
 */
function parseConfidence(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 1.0
  return Math.min(n, 2)
}

export async function getForecastOverview(req, res, next) {
  try {
    // 2026-08-08：读盘+缓存收敛到 utils/readStaticJson（TTL/LRU 与 flood/ports 同源），
    // 删私有 overviewCache 复制实现
    const data = await readStaticJson('forecast/index.json')
    // 使用 RESTful 响应格式（HTTP 状态码 + data）
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

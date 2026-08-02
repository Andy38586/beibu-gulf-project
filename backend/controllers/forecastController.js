import {
  getMapData,
  getPortData,
  getIndicatorData as queryIndicator,
  getTimeSeriesData as queryTimeSeries,
} from '../services/forecastService.js'
import { readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { BusinessError, ErrorCode } from '../utils/BusinessError.js'
import { sendSuccess } from '../utils/response.js'

// @arch-note 偏8: 预测数据存放于 backend/data/forecast/（阶段六 6.3 从 frontend/public 迁移，
// 解耦后端对前端目录的硬编码依赖）。__dirname=backend/controllers，上溯一级到 backend 再进入 data/forecast。
const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_PATH = join(__dirname, '../data/forecast/index.json')

// REQ-3（阶段2 补全）: overview 为部署时静态数据，加 5min TTL 模块级缓存，
// 避免公开接口每次请求读盘（与 floodAnalysisController.readJsonData 同模式）。
const OVERVIEW_CACHE_TTL_MS = 5 * 60 * 1000
let overviewCache = null
let overviewCachedAt = 0

/** 测试钩子：清空 overview 缓存，避免用例间互相污染（与 flood 的 _clearCacheForTest 同模式） */
export function _clearOverviewCacheForTest() {
  overviewCache = null
  overviewCachedAt = 0
}

/**
 * REQ-4（阶段2）: 情景系数（confidence）收口校验。
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
    const now = Date.now()
    if (!overviewCache || now - overviewCachedAt > OVERVIEW_CACHE_TTL_MS) {
      overviewCache = JSON.parse(await readFile(DATA_PATH, 'utf-8'))
      overviewCachedAt = now
    }
    // @arch-note 偏2: 使用 RESTful 响应格式（HTTP 状态码 + data）
    sendSuccess(res, overviewCache)
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

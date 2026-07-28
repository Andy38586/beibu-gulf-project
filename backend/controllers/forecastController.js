// TODO:1.2: 预测分析控制器
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

// @arch-note 偏8: 预测数据存放于 frontend/public/data/forecast/（前端 Mock 静态源，
// 后端读取同一份）。__dirname=backend/controllers，上溯两级到项目根再进入 frontend/public。
const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_PATH = join(__dirname, '../../frontend/public/data/forecast/index.json')

export async function getForecastOverview(req, res, next) {
  try {
    const data = JSON.parse(await readFile(DATA_PATH, 'utf-8'))
    // @arch-note 偏2: 使用 RESTful 响应格式（HTTP 状态码 + data）
    res.json({ code: 200, data })
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
    const data = await getMapData(indicator, time, Number(confidence) || 1.0)
    res.json({ code: 200, data })
  } catch (error) {
    next(error)
  }
}

export async function getPortForecast(req, res, next) {
  try {
    const { portId } = req.params
    const { indicator, start, end } = req.query
    const data = await getPortData(portId, indicator, start, end)
    res.json({ code: 200, data })
  } catch (error) {
    next(error)
  }
}

export async function getIndicatorData(req, res, next) {
  try {
    const { type } = req.params
    const { time, portId, confidence } = req.query
    const data = await queryIndicator(type, time, portId, Number(confidence) || 1.0)
    res.json({ code: 200, data })
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
      Number(confidence) || 1.0
    )
    res.json({ code: 200, data })
  } catch (error) {
    next(error)
  }
}

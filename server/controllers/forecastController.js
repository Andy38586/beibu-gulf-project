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

// FIX:偏8: 统一数据路径为 public/data/forecast/
const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_PATH = join(__dirname, '../../public/data/forecast/index.json')

export async function getForecastOverview(req, res) {
  try {
    const data = JSON.parse(await readFile(DATA_PATH, 'utf-8'))
    // FIX:偏2: 使用 RESTful 响应格式（HTTP 状态码 + data）
    res.json({ code: 200, data })
  } catch (error) {
    res.status(500).json({ code: 500, error: error.message })
  }
}

export async function getForecastMapData(req, res) {
  try {
    const { indicator, time, confidence } = req.query
    if (!indicator || !time) {
      return res.status(400).json({ code: 400, error: '缺少参数: indicator, time' })
    }
    const data = await getMapData(indicator, time, Number(confidence) || 1.0)
    res.json({ code: 200, data })
  } catch (error) {
    res.status(500).json({ code: 500, error: error.message })
  }
}

export async function getPortForecast(req, res) {
  try {
    const { portId } = req.params
    const { indicator, start, end } = req.query
    const data = await getPortData(portId, indicator, start, end)
    res.json({ code: 200, data })
  } catch (error) {
    res.status(500).json({ code: 500, error: error.message })
  }
}

export async function getIndicatorData(req, res) {
  try {
    const { type } = req.params
    const { time, portId, confidence } = req.query
    const data = await queryIndicator(type, time, portId, Number(confidence) || 1.0)
    res.json({ code: 200, data })
  } catch (error) {
    res.status(500).json({ code: 500, error: error.message })
  }
}

export async function getTimeSeriesData(req, res) {
  try {
    const { indicator, portId, start, end, granularity, confidence } = req.query
    const data = await queryTimeSeries(indicator, portId, start, end, granularity, Number(confidence) || 1.0)
    res.json({ code: 200, data })
  } catch (error) {
    res.status(500).json({ code: 500, error: error.message })
  }
}

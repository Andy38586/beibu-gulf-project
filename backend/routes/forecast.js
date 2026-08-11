import express from 'express'
const router = express.Router()
import {
  getForecastOverview,
  getForecastMapData,
  getPortForecast,
  getIndicatorData,
  getTimeSeriesData,
} from '../controllers/forecastController.js'

router.get('/', getForecastOverview)
// /overview 与 / 同义：前端实际调用 /overview 获取指标索引，显式注册避免落入 /:portId 通配
router.get('/overview', getForecastOverview)
router.get('/map', getForecastMapData)
router.get('/timeseries', getTimeSeriesData)
router.get('/indicator/:type', getIndicatorData)
// /:portId 须放最后，避免吞掉 /map、/overview、/timeseries、/indicator/:type
// [1.2] 孤儿路由（前端零消费）：保留作兼容端点，勿删（外部/OpenAPI 集成方可能引用）
router.get('/:portId', getPortForecast)

export default router

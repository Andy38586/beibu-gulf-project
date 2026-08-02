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
// R-1/b026: 前端 forecastAdapter.ts:349 调 /forecast/overview 获取可用指标索引；
// 此前缺此路由，请求落入 /:portId 被当作 portId='overview' 处理 → 返回空 {indicators:{}}。
router.get('/overview', getForecastOverview)
router.get('/map', getForecastMapData)
router.get('/timeseries', getTimeSeriesData)
router.get('/indicator/:type', getIndicatorData)
// 注意：/:portId 放在最后，避免匹配 /map、/overview、/timeseries、/indicator/:type
router.get('/:portId', getPortForecast)

export default router

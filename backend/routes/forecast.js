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
router.get('/map', getForecastMapData)
router.get('/timeseries', getTimeSeriesData)
router.get('/indicator/:type', getIndicatorData)
// 注意：/:portId 放在最后，避免匹配 /map、/timeseries、/indicator/:type
router.get('/:portId', getPortForecast)

export default router

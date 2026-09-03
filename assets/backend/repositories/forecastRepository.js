/**
 * forecastRepository — 预测数据访问层（6-05 六层契约收口）
 */
import { readStaticJson } from '../utils/readStaticJson.js'

/** 预测指标索引（forecast/index.json） */
export const readForecastIndex = () => readStaticJson('forecast/index.json')

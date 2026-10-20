// forecast 模块公开入口（W59 A2 半边，2026-10-20）：此前 business/index.ts 与本模块外的
// 消费方一律走 `@/business/forecast/composables/<file>` 深路径穿透模块内部。本文件把公开面
// 收成一个入口，深路径改走这里。逐符号列名而非 `export *`——与 core/index.ts 同款理由：
// 星号会把模块内部实现一起暴露，改内部结构就成对外破坏性变更。
export { useForecastComparison } from './composables/useForecastComparison'
export { useForecastLayer } from './composables/useForecastLayer'
export { useForecastRequest } from './composables/useForecastRequest'
export { useForecastTimeseries } from './composables/useForecastTimeseries'
// 首页/个人中心概览图表（6-01：此前 HomePage 深路径穿透，补收口）
export { useOverviewCharts } from './composables/useOverviewCharts'

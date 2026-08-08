// services/index.ts — 公开 API 入口
// 2026-08-08 数据搬后端：siteAnalysisAdapter / forecastAdapter 已删除（纯 api 直连 useApiRequest），
// 仅剩 floodAdapter（api + online 双模式）与数据源配置。
export * from './adapters/floodAdapter'
export * from './dataSourceConfig'
export * from './mapDataService'

// services/index.ts — 公开 API 入口
// 2026-08-08 数据搬后端：siteAnalysisAdapter / forecastAdapter / dataSourceConfig 已删除
// （纯 api 直连 useApiRequest；flood 的 api/online 模式内部化到 floodAdapter）。
export * from './adapters/floodAdapter'
export * from './mapDataService'

// business 公开 API 入口（全量收口，01 原则10 不豁免）
// 页面组件由 manifest/路由懒加载引用（动态 import 属构建优化，保留深路径）；
// 此处聚合 composables/constants，跨层消费方（App/router/views）一律走 @/business。
//
// 注（2026-10-13）：审计曾报「7 条 re-export 中 5 条无消费」，判为**不立案**——
// 「全量收口」是本文件自陈的公开面约定（与 core/index.ts 同款），零消费的 re-export
// 是该约定之下的面，不是死导出；删掉它们反而会让消费方被迫走深路径穿透。
// 故此处**不**按"零消费即负资产"处理。
export * from './forecast/composables/useForecastComparison'
export * from './forecast/composables/useForecastLayer'
export * from './forecast/composables/useForecastRequest'
export * from './forecast/composables/useForecastTimeseries'
export * from './manifest'
// 6-01：首页概览图表 composable 补 re-export（此前 HomePage 深路径穿透）
export * from './forecast/composables/useOverviewCharts'
// 兼容层 constants 已删，常量统一从 @/shared 取
export * from './flood-analysis/composables/useTerrainProfiles'

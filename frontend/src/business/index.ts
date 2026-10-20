// business 公开 API 入口（全量收口，01 原则10 不豁免）
// 此处聚合各模块的公开入口（不再穿透模块内部——W59 A2 半边，2026-10-20：
// 原 6 条 `./forecast/composables/<file>` / `./flood-analysis/composables/<file>` 是 barrel
// 自身穿透模块内部，已改为走 `./forecast`、`./flood-analysis` 的模块入口）；
// 跨层消费方（App/router/views）一律走 @/business。
//
// 注（2026-10-13）：审计曾报「7 条 re-export 中 5 条无消费」，判为**不立案**——
// 「全量收口」是本文件自陈的公开面约定（与 core/index.ts 同款），零消费的 re-export
// 是该约定之下的面，不是死导出；删掉它们反而会让消费方被迫走深路径穿透。
// 故此处**不**按"零消费即负资产"处理。
export * from './forecast'
export * from './manifest'
export * from './flood-analysis'

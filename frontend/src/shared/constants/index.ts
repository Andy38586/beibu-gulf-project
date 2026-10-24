// shared/constants 公开面入口。
//
// 没有它时，「target 组有入口才不许穿透」这条口径无从落地：`shared/constants/*` 的
// 深路径被当成"无法收敛的存量"计入基线。建入口后，新代码一律 `@/shared/constants`。
//
// `panels.ts` 刻意不收：它 `import type { PanelSpec } from '../layout/panelRegistry'`，
// 而 `panelRegistry.ts` 又要从这里取 `COMPARE_TOLERANCE` —— 收进来就成环
// （`.dependency-cruiser.cjs` 的 no-circular 是 error 级）。等面板规格的 host 下沉后再说。
export * from './api'
export * from './bizCodes'
export * from './chart'
export * from './colors'
export * from './flood'
export * from './forecast'
export * from './layers'
export * from './storageKeys'
export * from './tolerance'
export * from './ui'

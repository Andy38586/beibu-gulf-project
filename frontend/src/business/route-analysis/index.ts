// route-analysis 模块公开入口（W59 A2 半边，2026-10-20）：此前 business/preload.ts 走
// `@/business/route-analysis/constants/beibu3dTiles` 深路径穿透模块内部。本文件收口公开面。
// 只收 preload 与测试消费的三个符号；beibuTilesLayerId / shouldDropPortContent 仍是模块内
// 相对路径消费（RouteAnalysisPage.vue:36），不属跨模块公开面，不进本入口。
export { BEIBU_TILES, prepareBeibuTileset } from './constants/beibu3dTiles'
export type { BeibuTilesSpec } from './constants/beibu3dTiles'

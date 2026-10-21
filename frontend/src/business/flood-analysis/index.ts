// flood-analysis 模块公开入口（W59 A2 半边，2026-10-20）：把此前 business/index.ts 走
// `@/business/flood-analysis/composables/useTerrainProfiles` 的深路径收成一个入口。
// 逐符号列名而非 `export *`——星号会把模块内部实现一起暴露。
// 页面组件在公开面内：manifest.ts 按模块入口懒加载它（2026-10-20 修路由组件解析为 undefined）。
export { default as FloodAnalysisPage } from './FloodAnalysisPage.vue'
export { useTerrainProfiles } from './composables/useTerrainProfiles'

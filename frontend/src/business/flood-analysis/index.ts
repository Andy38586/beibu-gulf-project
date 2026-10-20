// flood-analysis 模块公开入口（W59 A2 半边，2026-10-20）：把此前 business/index.ts 走
// `@/business/flood-analysis/composables/useTerrainProfiles` 的深路径收成一个入口。
// 逐符号列名而非 `export *`——星号会把模块内部实现一起暴露。
export { useTerrainProfiles } from './composables/useTerrainProfiles'

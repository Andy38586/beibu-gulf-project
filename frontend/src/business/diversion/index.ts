// diversion 模块公开入口（W59 A2 半边，2026-10-20）：本模块无跨模块符号消费，公开面只有
// manifest 懒加载引用的页面组件。逐符号列名而非 `export *`——星号会把模块内部实现一起暴露。
export { default as DiversionPage } from './DiversionPage.vue'

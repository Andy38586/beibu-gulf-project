// core/index.ts — 公开 API 入口（Q4 816 拍板：全量收口，01 原则10 不豁免）
// 组件经 index.ts 聚合导出（UnifiedMap / AppLayout / GCSPanel 等），消费方一律走 @/core，禁止深路径穿透。
// renderers 内部实现（P8 后 CesiumRenderer 单文件，无拆分辅助文件）不 re-export
// renderers/index.ts 的 createRenderer/OLRenderer 仅在 core 内部使用，不对外暴露
export * from './config/map'
export * from './layout/composables/useScreenActions'
export * from './layout/navConfig'
export * from './layout/useMobileDrawer'
export * from './layout/useSliderFocus'
export * from './map/BusinessLayerManager'
export * from './map/composables/useBoundaryLayer'
export * from './map/composables/useBusinessLayers'
export * from './map/composables/useMapControls'
export * from './map/composables/usePortLayer'
export * from './map/layerAdapters'
export * from './map/renderers/MapRenderer'
export * from './provideKeys'
// Q4 收口：渲染器工厂/预载经入口对外（App.vue 使用；OLRenderer/CesiumRenderer 实现类不对外）
export { createRenderer, preloadCesium } from './map/renderers'
// Q4 收口：组件聚合导出（816 复核：README 已述、index 未落地，本行补齐）
export { default as UnifiedMap } from './map/UnifiedMap.vue'
export { default as AppLayout } from './layout/AppLayout.vue'
export { default as LayerControlPanel } from './map/components/LayerControlPanel.vue'
export { default as GCSPanel } from './layout/components/GCSPanel.vue'
export { default as GCSButton } from './layout/components/GCSButton.vue'
export { default as NavButton } from './layout/components/NavButton.vue'
export { default as MobileDrawer } from './layout/components/MobileDrawer.vue'
export { default as BottomNavBar } from './layout/components/BottomNavBar.vue'
// DebugToggle/GCSDebugOverlay 仅 DEV 构建加载（03 §三.3），不静态导出——保持 tree-shake 语义

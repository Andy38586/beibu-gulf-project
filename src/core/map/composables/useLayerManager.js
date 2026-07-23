import { computed, inject } from 'vue'

/**
 * useLayerManager - 图层管理 composable
 * 
 * 职责：提供图层注册、切换、清理等功能
 * 通过依赖注入获取 store，避免直接耦合
 */
export function useLayerManager() {
  // 通过 inject 获取 mapStore，避免直接依赖
  const store = inject('mapStore')
  
  if (!store) {
    console.warn('[useLayerManager] mapStore 未注入，请在父组件中提供')
    return {
      clearLayers: () => {},
      registerBaseLayer: () => {},
      registerBaseLayerWithRenderer: () => {},
      registerToggleable: () => {},
      toggleLayer: () => {},
      layerCatalog: computed(() => []),
    }
  }
  
  const layerCatalog = computed(() => store.layerCatalog)

  function clearLayers() {
    store.clearLayerCatalog()
  }

  function registerBaseLayer(key, label, show, hide) {
    store.registerBaseLayer(key, label, show, hide)
  }

  function registerToggleable(key, label, rendererOrShow, hide, visible = undefined) {
    if (typeof rendererOrShow === 'object' && rendererOrShow.setVisibility) {
      store.registerToggleable(key, label, () => rendererOrShow.setVisibility(key, true), () => rendererOrShow.setVisibility(key, false), visible)
    } else {
      store.registerToggleable(key, label, rendererOrShow, hide, visible)
    }
  }

  function registerBaseLayerWithRenderer(key, label, renderer) {
    const showFn = () => renderer.setBaseLayer(key === 'base-image' ? 'image' : 'vector')
    const hideFn = () => {}

    store.registerBaseLayer(key, label, showFn, hideFn)
  }

  function toggleLayer(key) {
    store.toggleLayer(key)
  }

  return {
    clearLayers,
    registerBaseLayer,
    registerBaseLayerWithRenderer,
    registerToggleable,
    toggleLayer,
    layerCatalog,
  }
}

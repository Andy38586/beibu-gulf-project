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

  function registerToggleable(key, label, rendererOrShow, hide) {
    let showFn, hideFn

    if (typeof rendererOrShow === 'object' && rendererOrShow.setVisibility) {
      showFn = () => rendererOrShow.setVisibility(key, true)
      hideFn = () => rendererOrShow.setVisibility(key, false)
    } else {
      showFn = rendererOrShow
      hideFn = hide
    }

    store.registerToggleable(key, label, showFn, hideFn)
  }

  function registerBaseLayerWithRenderer(key, label, renderer) {
    const showFn = () => renderer.setBaseLayer(key === 'base-image' ? 'image' : 'vector')
    const hideFn = () => {}

    store.registerBaseLayer(key, label, showFn, hideFn)
  }

  /**
   * 注册可切换图层（支持指定初始可见性）
   * @param {string} key - 图层唯一标识
   * @param {string} label - 图层显示名称
   * @param {Function} show - 显示图层的回调
   * @param {Function} hide - 隐藏图层的回调
   * @param {boolean} [visible=false] - 初始可见性
   */
  function registerToggleableWithVisibility(key, label, show, hide, visible = false) {
    store.registerToggleableWithVisibility(key, label, show, hide, visible)
  }

  function toggleLayer(key) {
    store.toggleLayer(key)
  }

  return {
    clearLayers,
    registerBaseLayer,
    registerBaseLayerWithRenderer,
    registerToggleable,
    registerToggleableWithVisibility,
    toggleLayer,
    layerCatalog,
  }
}

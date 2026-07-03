import { computed } from 'vue'
import { useMapStore } from '@/stores/map'

export function useLayerManager() {
  const store = useMapStore()
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

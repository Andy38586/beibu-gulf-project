import { useMapStore } from '@/stores/map'
import { ref } from 'vue'

const layerCatalog = ref([])

export function useLayerManager() {
  const store = useMapStore()

  function addLayers(routeName, layers) {
    store.registerLayers(routeName, layers)
  }
  function activate(routeName) {
    store.switchRoute(routeName)
  }
  function registerToggleable(key, label, layer) {
    layer.setVisible(true)
    layerCatalog.value.push({ key, label, layer, visible: true })
  }
  function toggleLayer(key) {
    const entry = layerCatalog.value.find((e) => e.key === key)
    if (!entry) return
    entry.visible = !entry.visible
    entry.layer.setVisible(entry.visible)
  }

  return { addLayers, activate, registerToggleable, toggleLayer, layerCatalog }
}

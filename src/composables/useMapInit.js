import Map from 'ol/Map'
import View from 'ol/View'
import { fromLonLat } from 'ol/proj'
import { useMapStore } from '@/stores/map'

export function useMapInit(targetId, { interactive = true, minZoom = 9 } = {}) {
  const store = useMapStore()

  if (store.map) {
    store.map.setTarget(targetId)
    return store.map
  }
  const map = new Map({
    target: targetId,
    interactions: interactive ? undefined : [],
    view: new View({
      center: fromLonLat([108.5752963, 21.760409]),
      zoom: 9,
      minZoom,
    }),
    layers: [],
  })
  store.setMap(map)
  return map
}

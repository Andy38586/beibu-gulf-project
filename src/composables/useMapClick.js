import { unByKey } from 'ol/Observable'

export function useMapClick(map, { onPortClick, onBlankClick } = {}) {
  const clickKey = map.on('click', (event) => {
    let clickedPort = false

    map.forEachFeatureAtPixel(event.pixel, (feature) => {
      if (feature.get('featureType') !== 'port') return false

      clickedPort = true
      const { geometry, ...portData } = feature.getProperties()
      onPortClick?.(portData)
      return true
    })

    if (!clickedPort) {
      onBlankClick?.()
    }
  })

  function destroy() {
    unByKey(clickKey)
  }

  return { destroy }
}

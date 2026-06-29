import VectorSource from 'ol/source/Vector'
import VectorLayer from 'ol/layer/Vector'
import GeoJSON from 'ol/format/GeoJSON'
import { fromLonLat } from 'ol/proj'
import Point from 'ol/geom/Point'
import Feature from 'ol/Feature'
import { Style, Fill, Stroke, Circle as CircleStyle } from 'ol/style'

export function useAnalysisLayer(map) {
  let coverageLayer = null
  let matchedLayer = null
  let isUpdating = false
  let pendingResult = null

  function clearLayers() {
    if (coverageLayer) {
      try {
        map.removeLayer(coverageLayer)
        // eslint-disable-next-line no-empty
      } catch (e) {}
      coverageLayer = null
    }
    if (matchedLayer) {
      try {
        map.removeLayer(matchedLayer)
        // eslint-disable-next-line no-empty
      } catch (e) {}
      matchedLayer = null
    }
  }
  function buildCoverageLayer(coverage) {
    const source = new VectorSource({
      features: new GeoJSON().readFeatures(coverage, { featureProjection: 'EPSG:3857' }),
    })
    return new VectorLayer({
      source,
      style: new Style({
        fill: new Fill({ color: 'rgba(64, 158, 255, 0.15)' }),
        stroke: new Stroke({ color: '#409eff', width: 1 }),
      }),
    })
  }
  function buildMatchedLayer(matchedXiaoqu) {
    const features = matchedXiaoqu.map((xq) => {
      const f = new Feature({ geometry: new Point(fromLonLat([xq.lng, xq.lat])) })
      f.setProperties(xq)
      return f
    })
    return new VectorLayer({
      source: new VectorSource({ features }),
      style: new Style({
        image: new CircleStyle({
          radius: 6,
          fill: new Fill({ color: '#e74c3c' }),
          stroke: new Stroke({ color: '#fff', width: 1.5 }),
        }),
      }),
    })
  }
  function setAnalysisResult({ coverage, matchedXiaoqu }) {
    if (isUpdating) {
      pendingResult = { coverage, matchedXiaoqu }
      return
    }
    isUpdating = true
    try {
      clearLayers()
      if (coverage) {
        coverageLayer = buildCoverageLayer(coverage)
        map.addLayer(coverageLayer)
      }
      if (matchedXiaoqu?.length) {
        matchedLayer = buildMatchedLayer(matchedXiaoqu)
        map.addLayer(matchedLayer)
      }
    } finally {
      isUpdating = false
      if (pendingResult) {
        const next = pendingResult
        pendingResult = null
        setAnalysisResult(next)
      }
    }
  }
  return { setAnalysisResult }
}

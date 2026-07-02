export function buildCoverageGeoJson(coverage) {
  const geojson = { ...coverage }
  geojson.features.forEach((f) => {
    f.properties.featureType = 'analysis-coverage'
  })
  return geojson
}

export function buildMatchedGeoJson(matchedXiaoqu) {
  return {
    type: 'FeatureCollection',
    features: matchedXiaoqu.map((xq) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [xq.lng, xq.lat],
      },
      properties: {
        ...xq,
        featureType: 'analysis-matched',
      },
    })),
  }
}

export const COVERAGE_STYLE = {
  fillColor: 'rgba(64, 158, 255, 0.15)',
  strokeColor: '#409eff',
  strokeWidth: 1,
  featureType: 'analysis-coverage',
}

export const MATCHED_STYLE = {
  size: 6,
  color: '#e74c3c',
  featureType: 'analysis-matched',
}

export function useAnalysisLayer() {
  let isUpdating = false
  let pendingResult = null

  function getAnalysisLayers(result) {
    const layers = []

    if (result.coverage) {
      layers.push({
        id: 'analysis-coverage',
        geojson: buildCoverageGeoJson(result.coverage),
        style: COVERAGE_STYLE,
      })
    }

    if (result.matchedXiaoqu?.length) {
      layers.push({
        id: 'analysis-matched',
        geojson: buildMatchedGeoJson(result.matchedXiaoqu),
        style: MATCHED_STYLE,
      })
    }

    return layers
  }

  function createUpdateHandler(renderer) {
    return function setAnalysisResult(result) {
      if (isUpdating) {
        pendingResult = result
        return
      }
      isUpdating = true
      try {
        renderer.removeLayer('analysis-coverage')
        renderer.removeLayer('analysis-matched')

        const layers = getAnalysisLayers(result)
        layers.forEach((layer) => {
          if (layer.style.featureType === 'analysis-coverage') {
            renderer.addGeoJsonLayer(layer.id, layer.geojson, layer.style)
          } else {
            renderer.addPointLayer(layer.id, layer.geojson.features.map(f => ({
              ...f.properties,
              lng: f.geometry.coordinates[0],
              lat: f.geometry.coordinates[1],
            })), layer.style)
          }
        })
      } finally {
        isUpdating = false
        if (pendingResult) {
          const next = pendingResult
          pendingResult = null
          setAnalysisResult(next)
        }
      }
    }
  }

  return { getAnalysisLayers, createUpdateHandler }
}
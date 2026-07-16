export function buildCoverageGeoJson(coverage) {
  if (!coverage) {
    return { type: 'FeatureCollection', features: [] }
  }
  let geojson
  if (coverage.type === 'FeatureCollection') {
    geojson = { ...coverage }
    geojson.features = coverage.features.map((f) => ({
      ...f,
      properties: { ...f.properties, featureType: 'analysis-coverage' },
    }))
  } else {
    geojson = {
      type: 'FeatureCollection',
      features: [
        { ...coverage, properties: { ...coverage.properties, featureType: 'analysis-coverage' } },
      ],
    }
  }
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
        label: '分析覆盖范围',
        geojson: buildCoverageGeoJson(result.coverage),
        style: COVERAGE_STYLE,
      })
    }

    if (result.matchedXiaoqu?.length) {
      layers.push({
        id: 'analysis-matched',
        label: '匹配小区',
        geojson: buildMatchedGeoJson(result.matchedXiaoqu),
        style: MATCHED_STYLE,
      })
    }

    return layers
  }

  function createUpdateHandler(renderer, registerToggleableFn) {
    return async function setAnalysisResult(result) {
      if (isUpdating) {
        pendingResult = result
        return
      }
      isUpdating = true
      try {
        renderer.removeLayer('analysis-coverage')
        renderer.removeLayer('analysis-matched')

        const layers = getAnalysisLayers(result)
        for (const layer of layers) {
          if (layer.style.featureType === 'analysis-coverage') {
            await renderer.addGeoJsonLayer(layer.id, layer.geojson, layer.style)
          } else {
            renderer.addPointLayer(
              layer.id,
              layer.geojson.features.map((f) => ({
                ...f.properties,
                lon: f.geometry.coordinates[0],
                lat: f.geometry.coordinates[1],
              })),
              layer.style,
            )
          }
          if (registerToggleableFn) {
            registerToggleableFn(layer.id, layer.label, renderer)
          }
        }
      } finally {
        isUpdating = false
        if (pendingResult) {
          const next = pendingResult
          pendingResult = null
          await setAnalysisResult(next)
        }
      }
    }
  }

  return { getAnalysisLayers, createUpdateHandler }
}

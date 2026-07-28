import { FACILITY_COLORS } from '@/shared/constants/colors'

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
    features: matchedXiaoqu
      .filter((xq) => {
        if (xq.lng === undefined || xq.lat === undefined) {
          if (import.meta.env.DEV) {
            console.warn('小区数据缺少坐标字段:', xq)
          }
          return false
        }
        if (typeof xq.lng !== 'number' || typeof xq.lat !== 'number') {
          if (import.meta.env.DEV) {
            console.warn('小区坐标字段类型无效:', xq)
          }
          return false
        }
        if (xq.lng < -180 || xq.lng > 180 || xq.lat < -90 || xq.lat > 90) {
          if (import.meta.env.DEV) {
            console.warn('小区坐标值超出有效范围:', xq)
          }
          return false
        }
        return true
      })
      .map((xq) => ({
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
  strokeColor: FACILITY_COLORS[0],
  strokeWidth: 1,
  featureType: 'analysis-coverage',
}

export const MATCHED_STYLE = {
  size: 6,
  color: FACILITY_COLORS[2],
  featureType: 'analysis-matched',
}

/**
 * 创建选址分析结果处理函数
 *
 * 通过 BusinessLayerManager 管理图层生命周期，
 * 不再直接调用 renderer 方法。
 *
 * @param {BusinessLayerManager} businessLayerManager
 * @returns {Function} setAnalysisResult(result)
 */
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

  function createUpdateHandler(businessLayerManager) {
    return async function setAnalysisResult(result) {
      if (isUpdating) {
        pendingResult = result
        return
      }
      isUpdating = true
      try {
        const layers = getAnalysisLayers(result)
        for (const layer of layers) {
          if (!businessLayerManager.has(layer.id)) {
            businessLayerManager.register(layer.id, {
              label: layer.label,
              layerType: 'geojson',
              data: layer.geojson,
              options: layer.style,
              visible: true,
            })
          } else {
            businessLayerManager.updateData(layer.id, {
              data: layer.geojson,
              options: layer.style,
            })
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

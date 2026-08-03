import type { Feature, FeatureCollection, Geometry } from 'geojson'

import type { BusinessLayerManager } from '@/core'
import { FACILITY_COLORS } from '@/shared'
import { logger } from '@/shared'
import type { AnalysisResult, LayerOptions, ScoredXiaoqu } from '@/types'

export function buildCoverageGeoJson(
  coverage: Feature<Geometry> | FeatureCollection<Geometry> | null
): FeatureCollection<Geometry> {
  if (!coverage) {
    return { type: 'FeatureCollection', features: [] }
  }
  let geojson: FeatureCollection<Geometry>
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

export function buildMatchedGeoJson(matchedXiaoqu: ScoredXiaoqu[]): FeatureCollection<Geometry> {
  return {
    type: 'FeatureCollection',
    features: matchedXiaoqu
      .filter((xq: ScoredXiaoqu) => {
        // 运行时防御：类型层 lng/lat 为 number，但后端数据可能缺失/非法，需逐条校验
        const lng = xq.lng as number | undefined
        const lat = xq.lat as number | undefined
        if (lng === undefined || lat === undefined) {
          logger.debug('小区数据缺少坐标字段:', xq)
          return false
        }
        if (typeof lng !== 'number' || typeof lat !== 'number') {
          logger.debug('小区坐标字段类型无效:', xq)
          return false
        }
        if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
          logger.debug('小区坐标值超出有效范围:', xq)
          return false
        }
        return true
      })
      .map((xq: ScoredXiaoqu) => ({
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

export const COVERAGE_STYLE: LayerOptions = {
  fillColor: 'rgba(64, 158, 255, 0.15)',
  strokeColor: FACILITY_COLORS[0],
  strokeWidth: 1,
  featureType: 'analysis-coverage',
}

export const MATCHED_STYLE: LayerOptions = {
  size: 6,
  color: FACILITY_COLORS[2],
  featureType: 'analysis-matched',
}

/** 分析图层描述符（getAnalysisLayers 返回的条目形状） */
interface AnalysisLayerDescriptor {
  id: string
  label: string
  geojson: FeatureCollection<Geometry>
  style: LayerOptions
}

/** useAnalysisLayer 返回值 */
interface UseAnalysisLayerReturn {
  getAnalysisLayers: (result: AnalysisResult) => AnalysisLayerDescriptor[]
  createUpdateHandler: (
    businessLayerManager: BusinessLayerManager
  ) => (result: AnalysisResult) => Promise<void>
}

/**
 * 创建选址分析结果处理函数
 * 通过 BusinessLayerManager 管理图层生命周期，
 * 不再直接调用 renderer 方法。
 * @param {BusinessLayerManager} businessLayerManager
 * @returns {Function} setAnalysisResult(result)
 */
export function useAnalysisLayer(): UseAnalysisLayerReturn {
  let isUpdating = false
  let pendingResult: AnalysisResult | null = null

  function getAnalysisLayers(result: AnalysisResult): AnalysisLayerDescriptor[] {
    const layers: AnalysisLayerDescriptor[] = []

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

  function createUpdateHandler(
    businessLayerManager: BusinessLayerManager
  ): (result: AnalysisResult) => Promise<void> {
    return async function setAnalysisResult(result: AnalysisResult): Promise<void> {
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

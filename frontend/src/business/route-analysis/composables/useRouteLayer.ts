import type { Feature, FeatureCollection, LineString } from 'geojson'

import type { BusinessLayerManager } from '@/core'
import type { LayerOptions, RoutePathResult } from '@/types'

/** 路径线图层 id（业务命名空间前缀 route-，关联 a066；BLM registry / catalog / 渲染器 featureType 三处同源） */
export const ROUTE_PATH_LAYER_ID = 'route-path'

/** 起点/终点标记图层 id */
export const ROUTE_ENDPOINT_LAYER_ID = 'route-endpoint'

/** createUpdateHandler 实际使用的 manager 方法子集（与 BLM 解耦，页面传入的 manager 无需完整 BLM 类型） */
type RouteLayerManager = Pick<BusinessLayerManager, 'register' | 'updateData' | 'has' | 'remove'>

/** 路径线样式（双引擎通用；色值走 shared 常量，不硬编码，专项7 GCS 合规） */
export const ROUTE_PATH_STYLE: LayerOptions = {
  strokeColor: '#3b82f6',
  strokeWidth: 4,
  featureType: ROUTE_PATH_LAYER_ID,
}

/** 端点标记样式 */
export const ROUTE_ENDPOINT_STYLE: LayerOptions = {
  size: 9,
  color: '#3b82f6',
  featureType: ROUTE_ENDPOINT_LAYER_ID,
}

/** 由后端路径折线构建线要素（route-path featureType；coordinates 为空则返回空 collection） */
export function buildRouteGeoJson(result: RoutePathResult): FeatureCollection<LineString> {
  const coords = result.coordinates ?? []
  const feature: Feature<LineString> = {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: coords,
    },
    properties: { featureType: ROUTE_PATH_LAYER_ID },
  }
  return coords.length >= 2
    ? { type: 'FeatureCollection', features: [feature] }
    : { type: 'FeatureCollection', features: [] }
}

/** 由起终点坐标构建端点标记点集（lng/lat 命名，双引擎通用） */
export function buildEndpointGeoJson(
  from: { lng: number; lat: number } | null,
  to: { lng: number; lat: number } | null
): FeatureCollection {
  const features: Feature[] = []
  if (from && Number.isFinite(from.lng) && Number.isFinite(from.lat)) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [from.lng, from.lat] },
      properties: { featureType: ROUTE_ENDPOINT_LAYER_ID, role: 'from' },
    })
  }
  if (to && Number.isFinite(to.lng) && Number.isFinite(to.lat)) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [to.lng, to.lat] },
      properties: { featureType: ROUTE_ENDPOINT_LAYER_ID, role: 'to' },
    })
  }
  return { type: 'FeatureCollection', features }
}

/** useRouteLayer 返回值 */
export interface UseRouteLayerReturn {
  /** 更新路径线 + 端点标记图层（幂等：data 为空时清理对应图层；未注册先注册） */
  updateRouteLayers: (
    manager: RouteLayerManager,
    result: RoutePathResult | null,
    from: { lng: number; lat: number } | null,
    to: { lng: number; lat: number } | null
  ) => void
  /** 清理全部路径相关图层 */
  clearRouteLayers: (manager: RouteLayerManager) => void
}

export function useRouteLayer(): UseRouteLayerReturn {
  function updateRouteLayers(
    manager: RouteLayerManager,
    result: RoutePathResult | null,
    from: { lng: number; lat: number } | null,
    to: { lng: number; lat: number } | null
  ): void {
    // 端点标记层：始终按起终点刷新
    const endpointGeo = buildEndpointGeoJson(from, to)
    if (endpointGeo.features.length > 0) {
      if (!manager.has(ROUTE_ENDPOINT_LAYER_ID)) {
        manager.register(ROUTE_ENDPOINT_LAYER_ID, {
          label: '起终点',
          layerType: 'geojson',
          data: endpointGeo,
          options: ROUTE_ENDPOINT_STYLE,
          visible: true,
        })
      } else {
        manager.updateData(ROUTE_ENDPOINT_LAYER_ID, { data: endpointGeo })
      }
    } else if (manager.has(ROUTE_ENDPOINT_LAYER_ID)) {
      manager.remove(ROUTE_ENDPOINT_LAYER_ID)
    }

    // 路径线层：found 且有折线才上图；空结果清理旧线
    if (result && result.coordinates.length >= 2) {
      const geo = buildRouteGeoJson(result)
      if (!manager.has(ROUTE_PATH_LAYER_ID)) {
        manager.register(ROUTE_PATH_LAYER_ID, {
          label: '路径线',
          layerType: 'geojson',
          data: geo,
          options: ROUTE_PATH_STYLE,
          visible: true,
        })
      } else {
        manager.updateData(ROUTE_PATH_LAYER_ID, { data: geo })
      }
    } else if (manager.has(ROUTE_PATH_LAYER_ID)) {
      manager.remove(ROUTE_PATH_LAYER_ID)
    }
  }

  function clearRouteLayers(manager: RouteLayerManager): void {
    if (manager.has(ROUTE_PATH_LAYER_ID)) manager.remove(ROUTE_PATH_LAYER_ID)
    if (manager.has(ROUTE_ENDPOINT_LAYER_ID)) manager.remove(ROUTE_ENDPOINT_LAYER_ID)
  }

  return { updateRouteLayers, clearRouteLayers }
}

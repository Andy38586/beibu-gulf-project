import type { Feature, FeatureCollection, LineString } from 'geojson'

import { useOwnedLayers } from '@/core'
import type { LayerOptions, RoutePathResult } from '@/types'

import { ROUTE_COLOR } from '../constants/colors'

/** 路径线图层 id（业务命名空间前缀 route-；BLM registry / catalog / 渲染器 featureType 三处同源） */
export const ROUTE_PATH_LAYER_ID = 'route-path'

/** 起点/途径点/终点标记图层 id */
export const ROUTE_ENDPOINT_LAYER_ID = 'route-endpoint'

/** 选点槽位 key：起点 → 途径 1 → 途径 2 → 终点（途径可空） */
export type RouteSlotKey = 'from' | 'waypoint-1' | 'waypoint-2' | 'to'

export const ROUTE_SLOT_KEYS: RouteSlotKey[] = ['from', 'waypoint-1', 'waypoint-2', 'to']

/** 面板选点槽位：坐标 + 可选 POI 名称（POI 选点时有，按钮优先显示名称） */
export interface RoutePoint {
  lng: number
  lat: number
  name?: string
}

export interface RouteSlot {
  key: RouteSlotKey
  point: RoutePoint | null
}

/** 路径线样式（双引擎通用；色值走模块 constants，不硬编码） */
export const ROUTE_PATH_STYLE: LayerOptions = {
  strokeColor: ROUTE_COLOR,
  strokeWidth: 4,
  featureType: ROUTE_PATH_LAYER_ID,
}

/** 端点标记样式 */
export const ROUTE_ENDPOINT_STYLE: LayerOptions = {
  size: 9,
  color: ROUTE_COLOR,
  featureType: ROUTE_ENDPOINT_LAYER_ID,
}

/**
 * 由多段路径结果构建线要素集合（每段一个 LineString Feature，同 featureType 同层）。
 * 前端逐段拼接：起点→途径1→途径2→终点按非空槽顺序分段查询，后端 /route/path 仅支持单段。
 * 单段 coordinates <2 点（未吸附无折线）跳过；全部无效返回空集。
 */
export function buildRouteGeoJson(segments: RoutePathResult[]): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = []
  for (const result of segments) {
    const coords = result.coordinates ?? []
    if (coords.length < 2) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: { featureType: ROUTE_PATH_LAYER_ID },
    })
  }
  return { type: 'FeatureCollection', features }
}

/** 由四槽选点构建端点标记点集（role 区分 from/waypoint-1/waypoint-2/to，name 随 properties 供气泡/调试） */
export function buildEndpointGeoJson(slots: RouteSlot[]): FeatureCollection {
  const features: Feature[] = []
  for (const slot of slots) {
    const p = slot.point
    if (!p || !Number.isFinite(p.lng) || !Number.isFinite(p.lat)) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        featureType: ROUTE_ENDPOINT_LAYER_ID,
        role: slot.key,
        ...(p.name ? { name: p.name } : {}),
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

/** useRouteLayer 返回值 */
export interface UseRouteLayerReturn {
  /** 更新路径线（多段）+ 端点标记图层（幂等：空集时清理对应图层；未注册先注册） */
  updateRouteLayers: (segments: RoutePathResult[], slots: RouteSlot[]) => void
  /**
   * 主动清（「清除全部」/ 重查前调用）。这是「现在就清」，不是「卸载时清」——
   * 卸载清由 useOwnedLayers 的 onScopeDispose 负责，两边幂等，无害。
   */
  clearRouteLayers: () => void
}

/**
 * 图层注册一律经 useOwnedLayers 登记归属（结构约束，同 useForecastLayer 先例）：
 * 注册即入册、卸载由作用域销毁统一清 —— 调用方因此**没有**「忘记清某一层」这个动作可漏。
 * manager 从注入取（页面与面板同源，见 useBusinessLayers），不再由调用方透传。
 */
export function useRouteLayer(): UseRouteLayerReturn {
  const owned = useOwnedLayers('route-analysis')

  function updateRouteLayers(segments: RoutePathResult[], slots: RouteSlot[]): void {
    // 端点标记层：始终按四槽刷新
    const endpointGeo = buildEndpointGeoJson(slots)
    if (endpointGeo.features.length > 0) {
      // 幂等上图：注册与更新走同一条调用；空集走下面的 unregister 清层
      owned.applyOrUpdate(ROUTE_ENDPOINT_LAYER_ID, {
        label: '起终点',
        layerType: 'geojson',
        data: endpointGeo,
        options: ROUTE_ENDPOINT_STYLE,
        visible: true,
      })
    } else {
      owned.unregister(ROUTE_ENDPOINT_LAYER_ID)
    }

    // 路径线层：至少一段有折线才上图；全空清理旧线
    const routeGeo = buildRouteGeoJson(segments)
    if (routeGeo.features.length > 0) {
      owned.applyOrUpdate(ROUTE_PATH_LAYER_ID, {
        label: '路径线',
        layerType: 'geojson',
        data: routeGeo,
        options: ROUTE_PATH_STYLE,
        visible: true,
      })
    } else {
      owned.unregister(ROUTE_PATH_LAYER_ID)
    }
  }

  function clearRouteLayers(): void {
    owned.unregister(ROUTE_PATH_LAYER_ID)
    owned.unregister(ROUTE_ENDPOINT_LAYER_ID)
  }

  return { updateRouteLayers, clearRouteLayers }
}

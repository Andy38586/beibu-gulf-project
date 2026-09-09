import type { Feature, FeatureCollection, LineString } from 'geojson'

import type { BusinessLayerManager } from '@/core'
import type { LayerOptions, RoutePathResult } from '@/types'

import { ROUTE_COLOR } from '../constants/colors'

/** 路径线图层 id（业务命名空间前缀 route-；BLM registry / catalog / 渲染器 featureType 三处同源） */
export const ROUTE_PATH_LAYER_ID = 'route-path'

/** 起点/途径点/终点标记图层 id */
export const ROUTE_ENDPOINT_LAYER_ID = 'route-endpoint'

/** createUpdateHandler 实际使用的 manager 方法子集（与 BLM 解耦，页面传入的 manager 无需完整 BLM 类型） */
export type RouteLayerManager = Pick<
  BusinessLayerManager,
  'register' | 'updateData' | 'has' | 'remove'
>

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
  updateRouteLayers: (
    manager: RouteLayerManager,
    segments: RoutePathResult[],
    slots: RouteSlot[]
  ) => void
  /** 清理全部路径相关图层 */
  clearRouteLayers: (manager: RouteLayerManager) => void
}

export function useRouteLayer(): UseRouteLayerReturn {
  function updateRouteLayers(
    manager: RouteLayerManager,
    segments: RoutePathResult[],
    slots: RouteSlot[]
  ): void {
    // 端点标记层：始终按四槽刷新
    const endpointGeo = buildEndpointGeoJson(slots)
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

    // 路径线层：至少一段有折线才上图；全空清理旧线
    const routeGeo = buildRouteGeoJson(segments)
    if (routeGeo.features.length > 0) {
      if (!manager.has(ROUTE_PATH_LAYER_ID)) {
        manager.register(ROUTE_PATH_LAYER_ID, {
          label: '路径线',
          layerType: 'geojson',
          data: routeGeo,
          options: ROUTE_PATH_STYLE,
          visible: true,
        })
      } else {
        manager.updateData(ROUTE_PATH_LAYER_ID, { data: routeGeo })
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

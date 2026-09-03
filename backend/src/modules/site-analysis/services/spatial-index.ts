// 逐行等价移植 backend/utils/spatialIndex.js。与前端 spatialIndex.ts 同名但实现不同（勿混用）：
// 后端 = 多边形覆盖查询（turf 点面判定）；前端 = 视口裁剪（rbush 矩形查询）。
import { booleanPointInPolygon, point } from '@turf/turf'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import RBush from 'rbush'

export interface IndexedItem<T> {
  minX: number
  minY: number
  maxX: number
  maxY: number
  data: T
}

interface LngLatLike {
  lng: number
  lat: number
}

interface GeoPolygonLike {
  geometry?: { type?: string; coordinates?: unknown } | null
}

export function createSpatialIndex<T extends LngLatLike>(xiaoquData: T[]): RBush<IndexedItem<T>> {
  const tree = new RBush<IndexedItem<T>>()
  const items = xiaoquData.map(
    (xq): IndexedItem<T> => ({
      minX: xq.lng,
      minY: xq.lat,
      maxX: xq.lng,
      maxY: xq.lat,
      data: xq,
    })
  )
  tree.load(items)
  return tree
}

export function queryByPolygon<T extends LngLatLike>(
  tree: RBush<IndexedItem<T>>,
  polygon: GeoPolygonLike
): T[] {
  // 规范化 polygon：确保 geometry.type 存在（@turf 7.x 要求完整 GeoJSON geometry）。
  // properties 占位：@turf 7 类型契约要求 Feature 必带 properties（运行时不读）
  const normalizedPolygon = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: polygon.geometry?.type || 'Polygon',
      coordinates: polygon.geometry?.coordinates || [],
    },
  } as unknown as Feature<Polygon | MultiPolygon>

  // 第一步：BBox 粗筛（快速过滤）
  const bbox = getPolygonBBox(normalizedPolygon)
  const candidates = tree.search(bbox)

  // 第二步：精确点在多边形内判定（使用 turf）
  return candidates
    .filter((item) => {
      const pt = point([item.data.lng, item.data.lat])
      return booleanPointInPolygon(pt, normalizedPolygon)
    })
    .map((item) => item.data)
}

function getPolygonBBox(polygon: { geometry: { type: string; coordinates: unknown } }): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  const { type, coordinates } = polygon.geometry
  const polygons = type === 'MultiPolygon' ? (coordinates as number[][][][]) : [coordinates]
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (const poly of polygons as number[][][][]) {
    if (!poly || !poly[0] || poly[0].length === 0) continue

    // 遍历所有环（外环 + 内环）
    for (const ring of poly) {
      if (!Array.isArray(ring)) continue
      for (const [x, y] of ring) {
        if (typeof x !== 'number' || typeof y !== 'number') continue
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
    }
  }

  // 如果没有有效坐标，返回默认 BBox
  if (minX === Infinity) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  }

  return { minX, minY, maxX, maxY }
}

// 逐行等价移植 backend/utils/spatialIndex.js。与前端 spatialIndex.ts 同名但实现不同（勿混用）：
// 后端 = 多边形覆盖查询（BBox 粗筛 + PostGIS 精确点面判定）；前端 = 视口裁剪（rbush 矩形查询）。
//
// 精确的点面判定已下沉 SQL（infra/db/spatial.repository.ts 的 ST_Covers），本模块只保留
// rbush BBox 粗筛：粗筛输出的是包含真解的超集，不影响结果正确性，只为压低下发 SQL 的
// 候选点数量（全城小区 2456 → 覆盖区内数十个）。
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

/**
 * BBox 粗筛：返回落在覆盖多边形外接矩形内的小区（超集，需下游精确判定）。
 * 多边形无坐标/无几何时返回空——调用方据此短路，不做全量下发。
 */
export function queryByBBox<T extends LngLatLike>(
  tree: RBush<IndexedItem<T>>,
  polygon: GeoPolygonLike
): T[] {
  const bbox = getPolygonBBox(polygon)
  if (bbox.minX > bbox.maxX) return []
  return tree.search(bbox).map((item) => item.data)
}

function getPolygonBBox(polygon: GeoPolygonLike): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  const type = polygon.geometry?.type
  const coordinates = polygon.geometry?.coordinates
  const polygons = type === 'MultiPolygon' ? (coordinates as number[][][][]) : [coordinates]
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (const poly of (polygons ?? []) as number[][][][]) {
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

  // 无有效坐标 → 空矩形（minX > maxX 作为哨兵，调用方按空结果处理）
  if (minX === Infinity) {
    return { minX: 1, minY: 1, maxX: 0, maxY: 0 }
  }

  return { minX, minY, maxX, maxY }
}

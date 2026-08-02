// 与前端 frontend/src/shared/utils/spatialIndex.ts 同名但实现不同（勿混用）：
// 后端 = 多边形覆盖查询（turf/queryByPolygon）；前端 = 视口裁剪（rbush 矩形查询）。
import RBush from 'rbush'
import { booleanPointInPolygon, point } from '@turf/turf'

export function createSpatialIndex(xiaoquData) {
  const tree = new RBush()
  const items = xiaoquData.map((xq) => ({
    minX: xq.lng,
    minY: xq.lat,
    maxX: xq.lng,
    maxY: xq.lat,
    data: xq,
  }))
  tree.load(items)
  return tree
}

export function queryByPolygon(tree, polygon) {
  // 规范化 polygon：确保 geometry.type 存在（@turf 7.x 要求完整 GeoJSON geometry）
  const normalizedPolygon = {
    type: 'Feature',
    geometry: {
      type: polygon.geometry?.type || 'Polygon',
      coordinates: polygon.geometry?.coordinates || [],
    },
  }

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

function getPolygonBBox(polygon) {
  const { type, coordinates } = polygon.geometry
  const polygons = type === 'MultiPolygon' ? coordinates : [coordinates]
  let minX = Infinity,
    maxX = -Infinity
  let minY = Infinity,
    maxY = -Infinity

  for (const poly of polygons) {
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

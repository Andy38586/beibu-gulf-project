import RBush from 'rbush'

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
  const bbox = getPolygonBBox(polygon)
  return tree.search(bbox).map((item) => item.data)
}

function getPolygonBBox(polygon) {
  const { type, coordinates } = polygon.geometry
  const polygons = type === 'MultiPolygon' ? coordinates : [coordinates]
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  
  for (const poly of polygons) {
    // AUDIT-GIS-006: 验证 poly[0] 存在性
    if (!poly || !poly[0] || poly[0].length === 0) continue
    
    // AUDIT-GIS-005: 遍历所有环（外环 + 内环）
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
  
  // AUDIT-GIS-005: 如果没有有效坐标，返回默认 BBox
  if (minX === Infinity) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  }
  
  return { minX, minY, maxX, maxY }
}
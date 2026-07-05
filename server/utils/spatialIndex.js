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
  const coords = polygon.geometry.coordinates[0]
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  for (const [x, y] of coords) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  return { minX, minY, maxX, maxY }
}
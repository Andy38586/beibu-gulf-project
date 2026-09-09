import { loadStatic, logger } from '@/shared'

// 钦北防三市市域选点校验：boundary.geojson 为 12 个区县面（钦州/防城港/北海各 4，
// adcode 4507xx/4506xx/4505xx，与选址 boundary 图层同一份静态数据源）。
// 选点落任意区县面内即合法；面外提示「暂无数据」——路网/POI 均只覆盖三市。
// 点面判断用射线法手写实现（12 面零开销；项目未引 turf，不为此单点新增依赖）。

const BOUNDARY_URL = '/data/site-selection/boundary.geojson'

interface BoundaryPolygon {
  type: 'Polygon' | 'MultiPolygon'
  coordinates: number[][][] | number[][][][]
}

let boundaryCache: BoundaryPolygon[] | null = null
let boundaryLoading: Promise<BoundaryPolygon[]> | null = null

/** 射线法单环判断：环边界穿越奇数次 = 内 */
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const crosses = yi > lat !== yj > lat
    if (crosses && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/** Polygon 判断：外环内且不在任一内环（洞）内 */
function pointInPolygonRings(lng: number, lat: number, rings: number[][][]): boolean {
  if (rings.length === 0 || !pointInRing(lng, lat, rings[0])) return false
  for (let k = 1; k < rings.length; k++) {
    if (pointInRing(lng, lat, rings[k])) return false
  }
  return true
}

/** 懒加载 + 模块级缓存区县边界面（静态资源走 loadStatic 统一入口） */
async function loadCityBoundary(): Promise<BoundaryPolygon[]> {
  if (boundaryCache) return boundaryCache
  if (!boundaryLoading) {
    boundaryLoading = loadStatic<{
      features: Array<{ geometry?: { type?: string; coordinates?: unknown } }>
    }>(BOUNDARY_URL)
      .then((geo) => {
        const features = (geo.features ?? [])
          .map((f) => f.geometry)
          .filter(
            (g): g is BoundaryPolygon =>
              (g?.type === 'Polygon' || g?.type === 'MultiPolygon') &&
              Array.isArray(g.coordinates)
          )
        boundaryCache = features
        logger.debug(`[useCityBoundary] 三市区县边界加载完成: ${features.length} 个面`)
        return features
      })
      .catch((error) => {
        boundaryLoading = null
        throw error
      })
  }
  return boundaryLoading
}

/**
 * 判断坐标是否落在钦北防三市市域内（12 区县任一命中即合法）。
 * 边界未就绪时视为范围外（首次点击偶发未加载完——提示后重试即可，不静默放行）。
 */
export async function isWithinThreeCities(lng: number, lat: number): Promise<boolean> {
  const features = await loadCityBoundary()
  if (features.length === 0) return false
  return features.some((f) => {
    if (f.type === 'Polygon') {
      return pointInPolygonRings(lng, lat, f.coordinates as number[][][])
    }
    return (f.coordinates as number[][][][]).some((rings) =>
      pointInPolygonRings(lng, lat, rings)
    )
  })
}

import type { Feature, FeatureCollection, Geometry, Point } from 'geojson'

/**
 * 把"坐标点对象数组"构造成 Point FeatureCollection。
 * 收敛 usePortLayer.buildPortGeoJson 与 useAnalysisLayer.buildMatchedGeoJson 的
 * 同构样板（过滤无效坐标 → 构造 Point Feature → 注入 featureType + 透传属性）。
 * 过滤谓词/属性透传由调用方经参数传入（各场景校验语义不同，不在此收口）。
 */
export function buildPointFeatureCollection<T>(
  items: T[],
  options: {
    /** 坐标提取：返回 null/NaN 表示该条应被过滤 */
    coordOf: (item: T) => { lng: number; lat: number } | null
    /** 过滤无效项（基于 coordOf 结果之外的前置条件） */
    validate?: (item: T) => boolean
    /** 属性构造（含 featureType 注入与字段透传） */
    propsOf: (item: T) => Record<string, unknown>
  }
): FeatureCollection<Geometry> {
  const features: Feature<Point>[] = []
  for (const item of items) {
    if (options.validate && !options.validate(item)) continue
    const coord = options.coordOf(item)
    if (!coord || !Number.isFinite(coord.lng) || !Number.isFinite(coord.lat)) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [coord.lng, coord.lat] },
      properties: options.propsOf(item),
    })
  }
  return { type: 'FeatureCollection', features }
}

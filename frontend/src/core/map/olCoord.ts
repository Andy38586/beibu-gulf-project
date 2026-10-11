/**
 * OL 渲染器坐标变换单点（EPSG:4326 经纬度 ↔ EPSG:3857 Web 墨卡托）。
 *
 * 考古 K1-1（2026-10-11，dup 棘轮最大单点群）：此前 7 处 `fromLonLat([p.lng, p.lat])`
 * 与 3 处 `toLonLat(...)` 散落 OLRenderer 各要素构造/事件回传点，换投影口径要改十处。
 * 按 z016 裁定（渲染器不拆分 ⇒ 新增内容另开文件）落在本文件。
 * 返回值一律收窄为二元组，免去各调用点的 `as [number, number]`。
 */
import Point from 'ol/geom/Point'
import { fromLonLat, toLonLat } from 'ol/proj'

/** 经纬度 → OL 投影坐标（要素几何/视图中心构造共用；重载支持直接吃二元组）。 */
export function toMapCoord(lng: number, lat: number): [number, number]
export function toMapCoord(coord: readonly [number, number]): [number, number]
export function toMapCoord(
  lngOrCoord: number | readonly [number, number],
  lat?: number
): [number, number] {
  const pair = typeof lngOrCoord === 'number' ? [lngOrCoord, lat] : lngOrCoord
  return fromLonLat(pair as [number, number]) as [number, number]
}

/** OL 投影坐标 → 经纬度（toMapCoord 的逆变换；点击/悬停事件回传与气泡锚点共用）。 */
export function toGeoCoord(coord: number[]): [number, number] {
  return toLonLat(coord) as [number, number]
}

/** 经纬度点 → OL Point 几何（散点/港口/设施等要素构造共用）。 */
export function toPointGeometry(lng: number, lat: number): Point {
  return new Point(toMapCoord(lng, lat))
}

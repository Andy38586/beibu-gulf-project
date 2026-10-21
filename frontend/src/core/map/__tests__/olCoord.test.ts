/**
 * OL 坐标变换单点（`../olCoord.ts`）契约回归测试。
 *
 * 动因（波 6 W37）：`toGeoCoord`（EPSG:3857 → 经纬度）被四个生产消费点共用
 * ——`OLRenderer.ts` 的 click 回传、pointer-move 经纬度、POI 气泡锚点、`getCameraState()`。
 * 变异实测：把 `return toLonLat(coord)` 改成 `return coord` 后，全前端
 * 121 files / 889 tests **全绿** ⇒ 反投影整个失效时没有一例测试变红。
 * 原因是四个消费点全在真 OL 事件回调或 `vi.mock` 掉的渲染器后面，测试到不了。
 *
 * 本案钉四条（对应 AGENTS §5.3 变异四式）：
 * 1. `toGeoCoord` 反投影数值正确（不是恒等）——摘 `toLonLat` 必红；
 * 2. `toGeoCoord` 与 `toMapCoord` 互逆（往返）——两支任一被摘都红；
 * 3. `toMapCoord` 两个重载等价（二元组与双参数同结果）；
 * 4. `toPointGeometry` 的几何坐标与 `toMapCoord` 同源（不是 `new Point([lng, lat])`）。
 *
 * 数值锚点取 2 位小数：避免浮点抖动把等价重构判红（§5.3 第三式不许红）。
 */
import { describe, expect, it } from 'vitest'

import { toGeoCoord, toMapCoord, toPointGeometry } from '../olCoord'

// 北部湾港区量级样本：EPSG:3857 米 → 经纬度。
// 期望值由 ol/proj 当场算得（109.14530702052186, 21.403021593854916），钉 2 位小数。
const MERCATOR_SAMPLE = [12150000, 2440000]
const EXPECTED_LONLAT: [number, number] = [109.15, 21.4]

describe('olCoord 坐标变换单点', () => {
  it('toGeoCoord 把 EPSG:3857 反投影成经纬度（不是恒等映射）', () => {
    const [lng, lat] = toGeoCoord(MERCATOR_SAMPLE)
    expect(Math.round(lng * 100) / 100).toBe(EXPECTED_LONLAT[0])
    expect(Math.round(lat * 100) / 100).toBe(EXPECTED_LONLAT[1])
  })

  it('toGeoCoord 与 toMapCoord 互逆（往返回到原经纬度）', () => {
    const lng = 109.13
    const lat = 21.42
    const [backLng, backLat] = toGeoCoord(toMapCoord(lng, lat))
    expect(backLng).toBeCloseTo(lng, 6)
    expect(backLat).toBeCloseTo(lat, 6)
  })

  it('toMapCoord 两个重载等价（二元组与双参数同结果）', () => {
    expect(toMapCoord([109.13, 21.42])).toEqual(toMapCoord(109.13, 21.42))
  })

  it('toPointGeometry 的几何坐标与 toMapCoord 同源', () => {
    expect(toPointGeometry(109.13, 21.42).getCoordinates()).toEqual(toMapCoord(109.13, 21.42))
  })
})

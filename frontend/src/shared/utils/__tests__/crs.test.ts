import { describe, expect, it } from 'vitest'

import { normalizePoint } from '../crs'

// normalizePoint 坐标系硬守卫（2026-09-08 数据平面大换代）：
// 声明非 84（EPSG:4326）的一律拒绝进入流通；无声明/4326 放行
describe('normalizePoint — 坐标系硬守卫（84-only 流通）', () => {
  it('无 crs 声明坐标正常放行', () => {
    expect(normalizePoint({ lng: 108.59, lat: 21.72 })).toEqual({
      lng: 108.59,
      lat: 21.72,
      crs: undefined,
    })
  })

  it('显式 crs=EPSG:4326 放行且回显 crs', () => {
    expect(normalizePoint({ lng: 108.59, lat: 21.72, crs: 'EPSG:4326' })).toEqual({
      lng: 108.59,
      lat: 21.72,
      crs: 'EPSG:4326',
    })
  })

  it.each(['EPSG:4490', 'EPSG:3857', 'EPSG:4547'] as const)(
    '声明非 84（%s）→ 拒绝返回 null（含 4490——只许存储，不许流通）',
    (crs) => {
      expect(normalizePoint({ lng: 108.59, lat: 21.72, crs })).toBeNull()
    }
  )

  it('坐标缺失返回 null（既有语义不变）', () => {
    expect(normalizePoint({ lng: undefined, lat: 21.72 })).toBeNull()
    expect(normalizePoint({ lng: 108.59 })).toBeNull()
  })

  it('lon/longitude 别名归一不受守卫影响', () => {
    expect(normalizePoint({ lon: 108.59, latitude: 21.72 })).toEqual({
      lng: 108.59,
      lat: 21.72,
      crs: undefined,
    })
  })
})

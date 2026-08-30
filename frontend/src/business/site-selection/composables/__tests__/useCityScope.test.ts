/**
 * useCityScope 判定逻辑测试。
 * 测试点取自 core/config/map.ts CITY_CENTERS（点击城市按钮后相机的落点），
 * 即"用户点了某个城市按钮 → 必须判定为该城市"这条主链路。
 */
import { describe, expect, it } from 'vitest'

import type { CameraState } from '@/types/renderer'

import { CITY_SCOPES, cityLabel, resolveCity } from '../useCityScope'

const cam = (lng: number, lat: number, extra: Partial<CameraState> = {}): CameraState => ({
  center: { lng, lat },
  zoom: 11,
  ...extra,
})

// 与 core/config/map.ts CITY_CENTERS 一致：点击城市按钮后的相机落点
const QINZHOU = [108.590379, 21.726917] as const
const FANGCHENGGANG = [108.340973, 21.617689] as const
const BEIHAI = [109.130658, 21.418792] as const

describe('useCityScope 城市作用域', () => {
  describe('CITY_SCOPES 常量', () => {
    it('三城 bbox 合法（min < max）且标签非空', () => {
      expect(CITY_SCOPES).toHaveLength(3)
      for (const s of CITY_SCOPES) {
        const [minLng, minLat, maxLng, maxLat] = s.bbox
        expect(minLng).toBeLessThan(maxLng)
        expect(minLat).toBeLessThan(maxLat)
        expect(s.label.length).toBeGreaterThan(0)
        expect(cityLabel(s.key)).toBe(s.label)
      }
    })

    it('cityLabel 对未知城市返回空串', () => {
      expect(cityLabel(null)).toBe('')
    })
  })

  describe('resolveCity 主链路：点城市按钮 → 判定为该城市', () => {
    it('钦州中心 → qz', () => {
      expect(resolveCity(cam(...QINZHOU))).toBe('qz')
    })

    it('北海中心 → bh', () => {
      expect(resolveCity(cam(...BEIHAI))).toBe('bh')
    })

    it('防城港中心 → fcg（该点同时落在钦州 bbox 内，须按中心距离择优）', () => {
      expect(resolveCity(cam(...FANGCHENGGANG))).toBe('fcg')
    })
  })

  describe('resolveCity 拒绝判定的场景', () => {
    it('2D 视图过小（zoom < 9.5，跨城视野）→ null', () => {
      expect(resolveCity(cam(...QINZHOU, { zoom: 8 }))).toBeNull()
      expect(resolveCity(cam(...QINZHOU, { zoom: 9.4 }))).toBeNull()
      expect(resolveCity(cam(...QINZHOU, { zoom: 9.5 }))).toBe('qz')
    })

    it('3D 相机过高（height > 300000 且无 zoom）→ null', () => {
      expect(resolveCity(cam(...QINZHOU, { zoom: undefined, height: 400000 }))).toBeNull()
      expect(resolveCity(cam(...QINZHOU, { zoom: undefined, height: 100000 }))).toBe('qz')
    })

    it('视野不在三城市区范围内（南宁方向）→ null', () => {
      expect(resolveCity(cam(108.37, 22.82))).toBeNull()
    })

    it('海上离岛不算市区视野（涠洲岛，2026-08-30 清洗后 bh bbox 南界 21.4061）→ null', () => {
      expect(resolveCity(cam(109.1, 21.05))).toBeNull()
    })

    it('相机缺失或坐标非法 → null', () => {
      expect(resolveCity(null)).toBeNull()
      expect(resolveCity(undefined)).toBeNull()
      expect(resolveCity(cam(Number.NaN, Number.NaN))).toBeNull()
      expect(resolveCity({ center: { lng: 108.59, lat: 21.72 } } as CameraState)).not.toBeNull()
    })
  })
})

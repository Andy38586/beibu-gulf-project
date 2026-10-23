import { describe, expect, it } from 'vitest'

import { formatLngLat } from '../formatLngLat'

describe('formatLngLat', () => {
  it('统一 4 位小数（不再出现 3 位精度的副本）', () => {
    expect(formatLngLat({ lng: 108.62, lat: 21.48 })).toBe('108.6200, 21.4800')
  })

  it('负数与多位小数按 4 位四舍五入', () => {
    expect(formatLngLat({ lng: -0.123456, lat: 21.987654 })).toBe('-0.1235, 21.9877')
  })

  it('整数坐标补足 4 位，保持列宽稳定', () => {
    expect(formatLngLat({ lng: 108, lat: 22 })).toBe('108.0000, 22.0000')
  })
})

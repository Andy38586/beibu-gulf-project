/**
 * 洪涝受影响设施图层形状回归测试（P0-2）
 *
 * 根因：原 renderAffectedFacilities 把 FeatureCollection 对象传给注册为 layerType:'points' 的图层，
 * points adapter 将 data 原样 as PointFeature[] 透传给 addPointLayer → features.length / features.map 抛 TypeError。
 *
 * 修复（方案A）：data 改为点数组（每个元素含数字 lng/lat + 业务字段），与 points adapter 契约一致。
 *
 * 本测试直接验证 points adapter 消费「点数组」时：
 *   1. 不抛错；
 *   2. addPointLayer 收到的第二个参数是数组；
 *   3. 数组元素为含数字 lng/lat 的对象，且携带业务字段（id/name/type/loss/damageRate）。
 * 这正是修复后 renderAffectedFacilities 所喂入的数据形状。
 */
import { describe, expect, it, vi } from 'vitest'

import { LAYER_ADAPTERS } from '@/core/map/layerAdapters'
import type { MapRenderer } from '@/types'

describe('P0-2 洪涝受影响设施 — points adapter 契约（点数组）', () => {
  function makeRenderer() {
    return {
      addPointLayer: vi.fn(),
      removeLayer: vi.fn(),
    }
  }

  it('points adapter 消费点数组时不抛错，且 addPointLayer 收到数组', () => {
    const renderer = makeRenderer()
    const points = [
      { lng: 108.5, lat: 21.7, id: 'f1', name: 'A港', type: 'port', loss: 10, damageRate: 0.5 },
      { lng: 108.6, lat: 21.8, id: 'f2', name: 'B码头', type: 'wharf', loss: 20, damageRate: 0.8 },
    ]

    expect(() =>
      LAYER_ADAPTERS.points.update(renderer as unknown as MapRenderer, 'flood-facilities', points, {
        markerColor: '#F56C6C',
        markerSize: 10,
        featureType: 'facility-point',
      })
    ).not.toThrow()

    // update 先 remove 再 add
    expect(renderer.removeLayer).toHaveBeenCalledWith('flood-facilities')
    expect(renderer.addPointLayer).toHaveBeenCalledTimes(1)

    const passed = renderer.addPointLayer.mock.calls[0][1]
    expect(Array.isArray(passed)).toBe(true)
    expect(passed).toHaveLength(2)
  })

  it('点数组元素含数字坐标与业务字段', () => {
    const renderer = makeRenderer()
    const points = [
      {
        lng: 108.5,
        lat: 21.7,
        id: 'f1',
        name: 'A港',
        type: 'port',
        port: 'QZ',
        loss: 10,
        damageRate: 0.5,
      },
    ]

    LAYER_ADAPTERS.points.update(renderer as unknown as MapRenderer, 'flood-facilities', points, {})

    const passed = renderer.addPointLayer.mock.calls[0][1]
    expect(passed[0]).toMatchObject({
      lng: 108.5,
      lat: 21.7,
      id: 'f1',
      name: 'A港',
      type: 'port',
      port: 'QZ',
      loss: 10,
      damageRate: 0.5,
    })
    expect(typeof passed[0].lng).toBe('number')
    expect(typeof passed[0].lat).toBe('number')
  })
})

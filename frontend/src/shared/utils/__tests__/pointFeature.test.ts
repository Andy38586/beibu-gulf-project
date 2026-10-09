import { describe, expect, it } from 'vitest'

import { buildPointFeatureCollection } from '../pointFeature'

interface Port {
  id: string
  lng: number
  lat: number
  name: string
}

const ports: Port[] = [
  { id: 'p1', lng: 108.6, lat: 21.6, name: '钦州' },
  { id: 'p2', lng: Number.NaN, lat: 21.7, name: '坏点' },
  { id: 'p3', lng: 109.1, lat: 21.4, name: '北海' },
]

describe('buildPointFeatureCollection — 点要素集合同构收敛', () => {
  it('validate 前置过滤与坐标守卫各自生效（NaN 坐标不落几何）', () => {
    const fc = buildPointFeatureCollection(ports, {
      validate: (p) => p.id !== 'p1',
      coordOf: (p) => ({ lng: p.lng, lat: p.lat }),
      propsOf: (p) => ({ name: p.name }),
    })
    expect(fc.features.map((f) => f.properties?.name)).toEqual(['北海'])
  })

  it('coordOf 返回 null 的项被剔除；geometry 与属性原样透传', () => {
    const fc = buildPointFeatureCollection(ports, {
      coordOf: (p) => (p.id === 'p2' ? null : { lng: p.lng, lat: p.lat }),
      propsOf: (p) => ({ featureType: 'port', name: p.name, id: p.id }),
    })
    expect(fc.type).toBe('FeatureCollection')
    expect(fc.features).toEqual([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [108.6, 21.6] },
        properties: { featureType: 'port', name: '钦州', id: 'p1' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [109.1, 21.4] },
        properties: { featureType: 'port', name: '北海', id: 'p3' },
      },
    ])
  })

  it('空输入 ⇒ 空 FeatureCollection', () => {
    const fc = buildPointFeatureCollection<Port>([], {
      coordOf: (p) => ({ lng: p.lng, lat: p.lat }),
      propsOf: (p) => ({ name: p.name }),
    })
    expect(fc).toEqual({ type: 'FeatureCollection', features: [] })
  })
})

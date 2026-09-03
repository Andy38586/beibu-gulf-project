import { beforeEach, describe, expect, it } from 'vitest'

import type { BusinessLayerManager } from '@/core'
import type { RoutePathResult } from '@/types'

import {
  buildEndpointGeoJson,
  buildRouteGeoJson,
  ROUTE_ENDPOINT_LAYER_ID,
  ROUTE_PATH_LAYER_ID,
  useRouteLayer,
} from '../useRouteLayer'

/** 最小 manager 假桩（记录调用，不触渲染器） */
function createFakeManager() {
  const registry = new Map<string, { data: unknown; options: unknown; label: string }>()
  const calls: string[] = []
  return {
    manager: {
      register: (key: string, desc: { data: unknown; options: unknown; label: string }) => {
        calls.push(`register:${key}`)
        registry.set(key, desc)
      },
      updateData: (key: string, desc: { data: unknown }) => {
        calls.push(`updateData:${key}`)
        const prev = registry.get(key)
        if (prev) registry.set(key, { ...prev, data: desc.data })
      },
      has: (key: string) => registry.has(key),
      remove: (key: string) => {
        calls.push(`remove:${key}`)
        registry.delete(key)
      },
    } as unknown as Pick<BusinessLayerManager, 'register' | 'updateData' | 'has' | 'remove'>,
    registry,
    calls,
  }
}

const RESULT: RoutePathResult = {
  found: true,
  mode: 'distance',
  distanceM: 8600,
  durationMin: 15.5,
  snapDistanceM: { from: 250, to: 81 },
  edgeCount: 30,
  coordinates: [
    [108.6, 21.6],
    [108.7, 21.7],
    [108.8, 21.8],
  ],
}

describe('useRouteLayer', () => {
  let fake: ReturnType<typeof createFakeManager>
  const { updateRouteLayers, clearRouteLayers } = useRouteLayer()

  beforeEach(() => {
    fake = createFakeManager()
  })

  it('有结果且有起终点 → 注册两条图层（路径线 featureType 同层 id）', () => {
    updateRouteLayers(fake.manager, RESULT, { lng: 108.6, lat: 21.6 }, { lng: 108.8, lat: 21.8 })
    expect(fake.manager.has(ROUTE_PATH_LAYER_ID)).toBe(true)
    expect(fake.manager.has(ROUTE_ENDPOINT_LAYER_ID)).toBe(true)
    expect(fake.calls).toContain(`register:${ROUTE_PATH_LAYER_ID}`)
    expect(fake.calls).toContain(`register:${ROUTE_ENDPOINT_LAYER_ID}`)
  })

  it('再次更新 → updateData（不重复注册）', () => {
    updateRouteLayers(fake.manager, RESULT, { lng: 108.6, lat: 21.6 }, { lng: 108.8, lat: 21.8 })
    updateRouteLayers(fake.manager, RESULT, { lng: 108.6, lat: 21.6 }, { lng: 108.8, lat: 21.8 })
    expect(fake.calls.filter((c) => c === `register:${ROUTE_PATH_LAYER_ID}`)).toHaveLength(1)
    expect(fake.calls.filter((c) => c === `updateData:${ROUTE_PATH_LAYER_ID}`)).toHaveLength(1)
  })

  it('空结果（result null）→ 移除路径线但保留端点标记', () => {
    updateRouteLayers(fake.manager, RESULT, { lng: 1, lat: 2 }, { lng: 3, lat: 4 })
    updateRouteLayers(fake.manager, null, { lng: 1, lat: 2 }, { lng: 3, lat: 4 })
    expect(fake.manager.has(ROUTE_PATH_LAYER_ID)).toBe(false)
    expect(fake.manager.has(ROUTE_ENDPOINT_LAYER_ID)).toBe(true)
  })

  it('clearRouteLayers → 两条图层全清', () => {
    updateRouteLayers(fake.manager, RESULT, { lng: 1, lat: 2 }, { lng: 3, lat: 4 })
    clearRouteLayers(fake.manager)
    expect(fake.manager.has(ROUTE_PATH_LAYER_ID)).toBe(false)
    expect(fake.manager.has(ROUTE_ENDPOINT_LAYER_ID)).toBe(false)
  })

  it('buildRouteGeoJson：折线 >=2 点产出 LineString，坐标不足产出空集', () => {
    const geo = buildRouteGeoJson(RESULT)
    expect(geo.features.length).toBe(1)
    expect(geo.features[0].geometry.type).toBe('LineString')
    expect(buildRouteGeoJson({ ...RESULT, coordinates: [[1, 2]] }).features.length).toBe(0)
  })

  it('buildEndpointGeoJson：跳过非法坐标（NaN/缺字段）', () => {
    const ok = buildEndpointGeoJson({ lng: 1, lat: 2 }, { lng: 3, lat: 4 })
    expect(ok.features.length).toBe(2)
    const partial = buildEndpointGeoJson(null, { lng: Number.NaN, lat: 4 })
    expect(partial.features.length).toBe(0)
  })
})

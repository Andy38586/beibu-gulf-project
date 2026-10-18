import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { BUSINESS_LAYER_MANAGER_KEY, type BusinessLayerManager } from '@/core'
import type { RoutePathResult } from '@/types'

import type { RouteSlot } from '../useRouteLayer'
import { ROUTE_ENDPOINT_LAYER_ID, ROUTE_PATH_LAYER_ID, useRouteLayer } from '../useRouteLayer'

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

type FeatureLike = { geometry: { type: string }; properties?: Record<string, unknown> }
type CollectionLike = { features: FeatureLike[] }
type Fake = ReturnType<typeof createFakeManager>
const pathData = (fake: Fake): CollectionLike =>
  fake.registry.get(ROUTE_PATH_LAYER_ID)!.data as CollectionLike
const endpointData = (fake: Fake): CollectionLike =>
  fake.registry.get(ROUTE_ENDPOINT_LAYER_ID)!.data as CollectionLike

const SLOT = (key: RouteSlot['key'], lng: number, lat: number): RouteSlot => ({
  key,
  point: { lng, lat },
})

/**
 * 在真实组件作用域内取 useRouteLayer，并 provide 假 manager。
 *
 * 为什么必须是这个形态（不是直接 `useRouteLayer()`）：
 *   注册经 `useOwnedLayers` 登记归属 ⇒ ① 需要活的作用域（它内部 `onScopeDispose` 挂卸载清），
 *   ② 需要能 inject 到 manager（它从 `useBusinessLayers` 取，不再是入参透传）。
 * 裸调两者都不成立，测出来的就不是生产形态。
 */
function mountLayerHook() {
  const fake = createFakeManager()
  let api!: ReturnType<typeof useRouteLayer>
  const wrapper = mount(
    {
      setup() {
        api = useRouteLayer()
        return () => null
      },
    },
    {
      global: {
        provide: {
          [BUSINESS_LAYER_MANAGER_KEY]: fake.manager as unknown as BusinessLayerManager,
        },
      },
    }
  )
  return { fake, api, wrapper }
}

describe('useRouteLayer', () => {
  it('有结果且有起终点 → 注册两条图层（路径线 featureType 同层 id）', () => {
    const { fake, api } = mountLayerHook()
    api.updateRouteLayers(
      [RESULT],
      [
        SLOT('from', 108.6, 21.6),
        { key: 'waypoint-1', point: null },
        { key: 'waypoint-2', point: null },
        SLOT('to', 108.8, 21.8),
      ]
    )
    expect(fake.manager.has(ROUTE_PATH_LAYER_ID)).toBe(true)
    expect(fake.manager.has(ROUTE_ENDPOINT_LAYER_ID)).toBe(true)
    expect(fake.calls).toContain(`register:${ROUTE_PATH_LAYER_ID}`)
    expect(fake.calls).toContain(`register:${ROUTE_ENDPOINT_LAYER_ID}`)
  })

  it('再次更新 → updateData（不重复注册）', () => {
    const { fake, api } = mountLayerHook()
    const slots = [SLOT('from', 108.6, 21.6), SLOT('to', 108.8, 21.8)]
    api.updateRouteLayers([RESULT], slots)
    api.updateRouteLayers([RESULT], slots)
    expect(fake.calls.filter((c) => c === `register:${ROUTE_PATH_LAYER_ID}`)).toHaveLength(1)
    expect(fake.calls.filter((c) => c === `updateData:${ROUTE_PATH_LAYER_ID}`)).toHaveLength(1)
  })

  it('空结果（segments 空）→ 移除路径线但保留端点标记', () => {
    const { fake, api } = mountLayerHook()
    api.updateRouteLayers([RESULT], [SLOT('from', 1, 2), SLOT('to', 3, 4)])
    api.updateRouteLayers([], [SLOT('from', 1, 2), SLOT('to', 3, 4)])
    expect(fake.manager.has(ROUTE_PATH_LAYER_ID)).toBe(false)
    expect(fake.manager.has(ROUTE_ENDPOINT_LAYER_ID)).toBe(true)
  })

  it('clearRouteLayers → 两条图层全清（主动清，供「清除全部」/重查前调用）', () => {
    const { fake, api } = mountLayerHook()
    api.updateRouteLayers([RESULT], [SLOT('from', 1, 2), SLOT('to', 3, 4)])
    api.clearRouteLayers()
    expect(fake.manager.has(ROUTE_PATH_LAYER_ID)).toBe(false)
    expect(fake.manager.has(ROUTE_ENDPOINT_LAYER_ID)).toBe(false)
  })

  it('作用域销毁（组件卸载）⇒ 两层自动注销，调用方无需手写清理', () => {
    const { fake, api, wrapper } = mountLayerHook()
    api.updateRouteLayers([RESULT], [SLOT('from', 1, 2), SLOT('to', 3, 4)])
    expect(fake.manager.has(ROUTE_PATH_LAYER_ID)).toBe(true)

    wrapper.unmount()

    expect(fake.manager.has(ROUTE_PATH_LAYER_ID)).toBe(false)
    expect(fake.manager.has(ROUTE_ENDPOINT_LAYER_ID)).toBe(false)
  })

  // 几何构造是模块内部实现（去 export 后按公开面 updateRouteLayers 取证）
  it('路径线几何：多段产出多个 LineString，单段 <2 点跳过（空集 ⇒ 不注册）', () => {
    const { fake, api } = mountLayerHook()
    const seg2: RoutePathResult = {
      ...RESULT,
      coordinates: [
        [109, 22],
        [109.1, 22.1],
      ],
    }
    api.updateRouteLayers([RESULT, seg2], [])
    const multi = pathData(fake)
    expect(multi.features.length).toBe(2)
    expect(multi.features.every((f) => f.geometry.type === 'LineString')).toBe(true)

    const { fake: fake2, api: api2 } = mountLayerHook()
    const thin: RoutePathResult = { ...RESULT, coordinates: [[1, 2]] }
    api2.updateRouteLayers([thin], [])
    expect(fake2.manager.has(ROUTE_PATH_LAYER_ID)).toBe(false)
  })

  it('端点几何：四槽仅非空槽产出，role 随 properties，POI 名带上', () => {
    const { fake, api } = mountLayerHook()
    const slots: RouteSlot[] = [
      { key: 'from', point: { lng: 1, lat: 2, name: '钦州港' } },
      { key: 'waypoint-1', point: null },
      { key: 'waypoint-2', point: { lng: Number.NaN, lat: 4 } },
      { key: 'to', point: { lng: 3, lat: 4 } },
    ]
    api.updateRouteLayers([], slots)
    const geo = endpointData(fake)
    expect(geo.features.length).toBe(2)
    expect(geo.features[0].properties?.role).toBe('from')
    expect(geo.features[0].properties?.name).toBe('钦州港')
    expect(geo.features[1].properties?.role).toBe('to')
  })
})
// D3 去 export：buildRouteGeoJson / buildEndpointGeoJson 已收为模块内部；本组是「公开面收窄」本身的判据。
describe('公开面收窄 — 两个几何构造器不得再导出', () => {
  const INTERNAL = ['buildRouteGeoJson', 'buildEndpointGeoJson']

  it('内部符号不在模块公开面；公开符号仍在（阳性对照）', async () => {
    const mod = (await import('../useRouteLayer')) as unknown as Record<string, unknown>
    for (const k of INTERNAL) expect(mod[k], k + ' 应已收为模块内部').toBeUndefined()
    expect(typeof mod.useRouteLayer).toBe('function')
  })
})

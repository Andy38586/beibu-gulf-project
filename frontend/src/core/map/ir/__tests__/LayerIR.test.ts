import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { BUSINESS_LAYER_MANAGER_KEY, type BusinessLayerManager } from '@/core'

import { layerIRKey, taskResultToIR, useLayerIRLayer, type LayerIR } from '../LayerIR'

// LayerIR 单测（v4-S8）：任务结果 → IR 判定、去重键含 kind、toggle 拖出语义。
// 变异四式取证见提交正文（去重键漏 kind 红 / toggle 反转红 / 结构判定放宽红）。

/** 最小 manager 假桩（记录调用与注册表，不触渲染器）——useRouteLayer.test 同款 */
function createFakeManager() {
  const registry = new Map<string, { data: unknown; options: Record<string, unknown> }>()
  const calls: string[] = []
  return {
    manager: {
      has: (key: string) => registry.has(key),
      register: (key: string, desc: { data: unknown; options: Record<string, unknown> }) => {
        calls.push(`register:${key}`)
        registry.set(key, desc)
      },
      updateData: (key: string, payload: { data: unknown; options?: Record<string, unknown> }) => {
        calls.push(`updateData:${key}`)
        const prev = registry.get(key)
        if (prev)
          registry.set(key, { data: payload.data, options: payload.options ?? prev.options })
      },
      remove: (key: string) => {
        calls.push(`remove:${key}`)
        registry.delete(key)
      },
    } as unknown as Pick<BusinessLayerManager, 'has' | 'register' | 'updateData' | 'remove'>,
    registry,
    calls,
  }
}

function mountLayerHook() {
  const fake = createFakeManager()
  let api!: ReturnType<typeof useLayerIRLayer>
  mount(
    {
      setup() {
        api = useLayerIRLayer()
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
  return { fake, api }
}

const FLOOD_SLOT = {
  taskId: 't-flood-1',
  route: '/flood-analysis',
  domain: 'flood-areas' as const,
  result: {
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [108.6, 21.7],
              [108.7, 21.7],
              [108.7, 21.8],
              [108.6, 21.7],
            ],
          ],
        },
        properties: {},
      },
    ],
    statistics: { floodedKm2: 12 },
  },
}

const ROUTE_SLOT = {
  taskId: 't-route-1',
  route: '/route-analysis',
  domain: 'route-path' as const,
  result: {
    found: true,
    coordinates: [
      [108.6, 21.6],
      [108.8, 21.8],
    ],
  },
}

describe('taskResultToIR（结构判定，L3 不引业务类型）', () => {
  it('浸没载荷 → polygon IR：id 含 taskId+kind、data 为 FC、样式带域色', () => {
    const ir = taskResultToIR(FLOOD_SLOT)
    expect(ir).not.toBeNull()
    expect(ir!.kind).toBe('polygon')
    expect(ir!.id).toBe(`task-ir-t-flood-1-polygon`)
    expect(ir!.data.features).toHaveLength(1)
    expect(ir!.meta.label).toBe('浸没结果')
  })

  it('航线载荷 → polyline IR（coordinates 进 LineString）', () => {
    const ir = taskResultToIR(ROUTE_SLOT)
    expect(ir!.kind).toBe('polyline')
    expect(ir!.data.features[0].geometry).toMatchObject({ type: 'LineString' })
  })

  it('不可渲染域（forecast-timeseries）→ null：不支持就不出手柄', () => {
    expect(
      taskResultToIR({
        taskId: 't1',
        route: '/forecast',
        domain: 'forecast-timeseries',
        result: { series: [] },
      })
    ).toBeNull()
  })

  it('畸形结果 → null（浸没缺 features / 航线坐标 <2 点），绝不造空几何充数', () => {
    expect(
      taskResultToIR({ taskId: 't1', route: '/flood-analysis', domain: 'flood-areas', result: {} })
    ).toBeNull()
    expect(
      taskResultToIR({
        taskId: 't2',
        route: '/route-analysis',
        domain: 'route-path',
        result: { coordinates: [[108.6, 21.6]] },
      })
    ).toBeNull()
  })
})

describe('layerIRKey（去重键：taskId + kind）', () => {
  it('同任务不同 kind → 键不同（多边形与折线可并存）；同任务同 kind → 键相同', () => {
    const base = { origin: { taskId: 't-1', route: '/flood-analysis' } }
    expect(layerIRKey({ ...base, kind: 'polygon' })).not.toBe(
      layerIRKey({ ...base, kind: 'polyline' })
    )
    expect(layerIRKey({ ...base, kind: 'polygon' })).toBe(layerIRKey({ ...base, kind: 'polygon' }))
  })
})

describe('useLayerIRLayer（BLM 通道：渲染/撤下/toggle）', () => {
  it('toggleIR：未上图 → 渲染；再拖 → 撤下（永不产生第二份）', () => {
    const { fake, api } = mountLayerHook()
    const ir = taskResultToIR(FLOOD_SLOT) as LayerIR
    expect(api.toggleIR(ir)).toBe('added')
    expect(fake.manager.has('task-ir-t-flood-1-polygon')).toBe(true)
    expect(api.toggleIR(ir)).toBe('removed')
    expect(fake.manager.has('task-ir-t-flood-1-polygon')).toBe(false)
  })

  it('已上图再 render → 走 updateData 不重复注册（去重的实现载体）', () => {
    const { fake, api } = mountLayerHook()
    const ir = taskResultToIR(FLOOD_SLOT) as LayerIR
    api.renderIR(ir)
    api.renderIR(ir)
    expect(fake.calls.filter((c) => c === 'register:task-ir-t-flood-1-polygon')).toHaveLength(1)
    expect(fake.calls.filter((c) => c === 'updateData:task-ir-t-flood-1-polygon')).toHaveLength(1)
  })

  it('多边形与折线互不顶掉（键含 kind 的行为面）', () => {
    const { fake, api } = mountLayerHook()
    const flood = taskResultToIR(FLOOD_SLOT) as LayerIR
    const route = taskResultToIR(ROUTE_SLOT) as LayerIR
    api.renderIR(flood)
    api.renderIR(route)
    expect(fake.manager.has('task-ir-t-flood-1-polygon')).toBe(true)
    expect(fake.manager.has('task-ir-t-route-1-polyline')).toBe(true)
  })
})

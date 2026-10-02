import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { BUSINESS_LAYER_MANAGER_KEY, type BusinessLayerManager } from '@/core'
import { PORT_PORTS, diversionArcLayerId } from '@/shared'

import {
  DIVERSION_CANAL_LAYER_ID,
  useDiversionLayer,
  type DiversionArcSpec,
} from '../useDiversionLayer'

// useDiversionLayer 行为契约（mock manager，同 useRouteLayer.test 先例）：
// 注册/更新幂等、cesium 引擎限定、弧宽随值变化、高亮换色、清理全键。

/** 最小 manager 假桩（记录调用与注册表，不触渲染器） */
function createFakeManager() {
  const registry = new Map<
    string,
    { data: unknown; options: Record<string, unknown>; engines?: string[] }
  >()
  const calls: string[] = []
  return {
    manager: {
      register: (
        key: string,
        desc: { data: unknown; options: Record<string, unknown>; engines?: string[] }
      ) => {
        calls.push(`register:${key}`)
        registry.set(key, desc)
      },
      updateData: (key: string, payload: { data: unknown; options?: Record<string, unknown> }) => {
        calls.push(`updateData:${key}`)
        const prev = registry.get(key)
        if (prev)
          registry.set(key, {
            ...prev,
            data: payload.data,
            options: payload.options ?? prev.options,
          })
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

/**
 * 真实组件作用域内取 composable 并 provide 假 manager（useRouteLayer.test 同理由：
 * useOwnedLayers 需要活作用域 + inject manager，裸调测的不是生产形态）。
 */
function mountLayerHook() {
  const fake = createFakeManager()
  let api!: ReturnType<typeof useDiversionLayer>
  mount(
    {
      setup() {
        api = useDiversionLayer()
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

const CANAL_LINE: Array<[number, number]> = [
  [109.29, 22.7],
  [108.62, 21.87],
]

const SPECS: DiversionArcSpec[] = [
  { portId: 'qinzhou', portName: '钦州港', start: CANAL_LINE[1], end: [108.59, 21.73], value: 700 },
  { portId: 'beihai', portName: '北海港', start: CANAL_LINE[1], end: [109.13, 21.42], value: 170 },
  {
    portId: 'fangchenggang',
    portName: '防城港',
    start: CANAL_LINE[1],
    end: [108.34, 21.62],
    value: 300,
  },
]

describe('useDiversionLayer', () => {
  it('运河线 + 三弧全部注册；弧线/运河线均限 cesium 引擎', () => {
    const { fake, api } = mountLayerHook()
    api.updateCanalLayer([CANAL_LINE])
    api.updateArcLayers(SPECS)
    expect(fake.manager.has(DIVERSION_CANAL_LAYER_ID)).toBe(true)
    for (const { key } of PORT_PORTS) {
      expect(fake.manager.has(diversionArcLayerId(key))).toBe(true)
    }
    expect(fake.registry.get(DIVERSION_CANAL_LAYER_ID)?.engines).toEqual(['cesium'])
    expect(fake.registry.get(diversionArcLayerId('qinzhou'))?.engines).toEqual(['cesium'])
  })

  it('幂等：二次更新走 updateData 不重复注册（年份切换重算弧值不炸注册表）', () => {
    const { fake, api } = mountLayerHook()
    api.updateArcLayers(SPECS)
    api.updateArcLayers(SPECS.map((s) => ({ ...s, value: s.value + 1 })))
    expect(fake.calls.filter((c) => c === 'register:diversion-arc-qinzhou')).toHaveLength(1)
    expect(fake.calls).toContain('updateData:diversion-arc-qinzhou')
  })

  it('弧宽相对编码：值最大的弧最宽（删 arcWidthFor 相对编码即红）', () => {
    const { fake, api } = mountLayerHook()
    api.updateArcLayers(SPECS)
    const w = (portId: string): number =>
      Number(fake.registry.get(diversionArcLayerId(portId))?.options.strokeWidth)
    expect(w('qinzhou')).toBeGreaterThan(w('beihai')) // 700 > 170
    expect(w('fangchenggang')).toBeGreaterThan(w('beihai')) // 300 > 170
  })

  it('高亮换色：highlightPortId 命中弧用高亮色，其余保持常规色', () => {
    const { fake, api } = mountLayerHook()
    api.updateArcLayers(SPECS)
    const normal = fake.registry.get(diversionArcLayerId('qinzhou'))?.options.strokeColor
    api.updateArcLayers(SPECS, 'beihai')
    expect(fake.registry.get(diversionArcLayerId('beihai'))?.options.strokeColor).not.toBe(normal)
    expect(fake.registry.get(diversionArcLayerId('qinzhou'))?.options.strokeColor).toBe(normal)
  })

  it('清理收全键：运河线 + 全部弧线键（新增港口键自动纳入，无手抄清单）', () => {
    const { fake, api } = mountLayerHook()
    api.updateCanalLayer([CANAL_LINE])
    api.updateArcLayers(SPECS)
    api.clearDiversionLayers()
    expect(fake.manager.has(DIVERSION_CANAL_LAYER_ID)).toBe(false)
    for (const { key } of PORT_PORTS) {
      expect(fake.manager.has(diversionArcLayerId(key))).toBe(false)
    }
  })

  it('空运河线段集 → unregister（真线位加载失败不留残线）', () => {
    const { fake, api } = mountLayerHook()
    api.updateCanalLayer([CANAL_LINE])
    api.updateCanalLayer([])
    expect(fake.manager.has(DIVERSION_CANAL_LAYER_ID)).toBe(false)
  })
})

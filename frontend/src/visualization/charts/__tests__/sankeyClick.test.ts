import { describe, expect, it, vi } from 'vitest'

import { bindSankeyClick, type SankeyClickPayload } from '../sankeyClick'

// bindSankeyClick 单测：echarts 点击形态 → 载荷的纯逻辑（真实例在 jsdom 无 canvas 不可挂）。

function createFakeInstance() {
  const handlers: Array<[string, (...args: unknown[]) => void]> = []
  const offs: Array<[string, (...args: unknown[]) => void]> = []
  return {
    instance: {
      on: (type: string, handler: (...args: unknown[]) => void): void => {
        handlers.push([type, handler])
      },
      off: (type: string, handler: (...args: unknown[]) => void): void => {
        offs.push([type, handler])
      },
    },
    fire: (p: unknown) => handlers[0][1](p),
    handlers,
    offs,
  }
}

describe('bindSankeyClick', () => {
  it('node 点击 → 载荷 {kind:node, name, value}', () => {
    const { instance, fire } = createFakeInstance()
    const got: SankeyClickPayload[] = []
    bindSankeyClick(instance, (p) => got.push(p))
    fire({ dataType: 'node', name: '钦州港', value: 742.54 })
    expect(got).toEqual([{ kind: 'node', name: '钦州港', value: 742.54 }])
  })

  it('edge 点击 → 载荷带 source/target（联动按目标港定位弧线）', () => {
    const { instance, fire } = createFakeInstance()
    const got: SankeyClickPayload[] = []
    bindSankeyClick(instance, (p) => got.push(p))
    fire({ dataType: 'edge', data: { source: '平陆运河', target: '北海港' }, value: 170 })
    expect(got[0]).toMatchObject({ kind: 'edge', source: '平陆运河', target: '北海港', value: 170 })
  })

  it('非 node/edge 的点击（图例/空白）静默丢弃', () => {
    const { instance, fire } = createFakeInstance()
    const got: SankeyClickPayload[] = []
    bindSankeyClick(instance, (p) => got.push(p))
    fire({ dataType: 'somethingElse' })
    fire({})
    expect(got).toHaveLength(0)
  })

  it('返回解绑器：off 用同一 handler 引用（注册注销同作用域，禁忌 4）', () => {
    const { instance, handlers, offs } = createFakeInstance()
    const dispose = bindSankeyClick(instance, vi.fn())
    dispose()
    expect(offs).toHaveLength(1)
    expect(offs[0][0]).toBe('click')
    expect(offs[0][1]).toBe(handlers[0][1])
  })
})

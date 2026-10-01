import { describe, expect, it } from 'vitest'

import { DiversionController } from '../src/modules/diversion/controllers/diversion.controller'
import { DiversionService } from '../src/modules/diversion/services/diversion.service'

// 分流端点解析单测（无 DB 纯函数编排）：年份解析/clamp/桑基流结构与 F3 份额同源。

const controller = new DiversionController(new DiversionService())

describe('DiversionController.breakdown', () => {
  it('缺省 2035；锚点年原值；域外 clamp 至 2027/2050', () => {
    expect(controller.breakdown(undefined)).toMatchObject({ year: 2035 })
    expect(controller.breakdown('2030')).toMatchObject({ year: 2030 })
    expect(controller.breakdown('2027')).toMatchObject({ year: 2027 })
    // 越界显式拒收（不静默 clamp——API 语义从严）
    expect(() => controller.breakdown('2060')).toThrow(/year 须/)
  })
  it('非法年份 400 语义抛错（INVALID_PARAMS 走 BusinessError）', () => {
    expect(() => controller.breakdown('abc')).toThrow(/year 非数值/)
  })
  it('sandCement 恒 0 在端点输出中显式在场（负结果锚点）', () => {
    const r = controller.breakdown('2035') as { transfer: { sandCement: number } }
    expect(r.transfer.sandCement).toBe(0)
  })
  it('三港 sankey 流与 byPort total 一致（分摊守恒）', () => {
    const r = controller.breakdown('2040') as {
      byPort: Record<string, { total: number }>
      sankeyFlows: Array<{ value: number }>
    }
    const sumFlows = r.sankeyFlows.reduce((a, b) => a + b.value, 0)
    const sumPorts = Object.values(r.byPort).reduce((a, b) => a + b.total, 0)
    expect(sumFlows).toBeCloseTo(sumPorts, 9)
  })
})

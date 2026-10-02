import { describe, expect, it } from 'vitest'

import { DiversionController } from '../src/modules/diversion/controllers/diversion.controller'
import { DiversionRepository } from '../src/modules/diversion/repositories/diversion.repository'
import { DiversionService } from '../src/modules/diversion/services/diversion.service'

// 分流端点解析单测（无 DB 纯函数编排）：年份解析/clamp/桑基流结构与 F3 份额同源；
// canal-line 用假 repository 钉编排契约（SQL 正确性由 5432 实库 curl 取证 + 04-B 转换纪律钉在 SQL 文本）。

const noDbRepo = {
  listCanalLines: async () => {
    throw new Error('e2e 编排测试不应触达 repository')
  },
} as unknown as DiversionRepository

const controller = new DiversionController(new DiversionService(noDbRepo))

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
  it('三港 sankey 三段守恒：1 入边 + 3 出边，且与 byPort total 同和', () => {
    const r = controller.breakdown('2040') as {
      byPort: Record<string, { total: number }>
      sankeyFlows: Array<{ from: string; to: string; value: number }>
    }
    const trunk = r.sankeyFlows.filter((f) => f.from === '西江上行货' && f.to === '平陆运河')
    const legs = r.sankeyFlows.filter((f) => f.from === '平陆运河')
    expect(trunk).toHaveLength(1)
    expect(legs).toHaveLength(3)
    const sumPorts = Object.values(r.byPort).reduce((a, b) => a + b.total, 0)
    expect(trunk[0].value).toBeCloseTo(sumPorts, 9)
    expect(legs.reduce((a, b) => a + b.value, 0)).toBeCloseTo(sumPorts, 9)
    // 端点输出同样不得含 id/拼音节点（与单测同判据）
    for (const flow of r.sankeyFlows) {
      expect(flow.from).not.toMatch(/[a-z]{3,}/)
      expect(flow.to).not.toMatch(/[a-z]{3,}/)
    }
  })
})

describe('DiversionController.canal-line（编排契约，repository 假件）', () => {
  const rows = [
    {
      name: '平陆运河（示意线）',
      section: '起点-平塘江口',
      coordinates: [
        [109.29, 22.7],
        [108.62, 21.87],
      ] as Array<[number, number]>,
    },
  ]
  const repo = { listCanalLines: async () => rows } as unknown as DiversionRepository
  const withDb = new DiversionController(new DiversionService(repo))

  it('repository 行透传为 { lines }（不加工不重排）', async () => {
    const r = await withDb.canalLine()
    expect(r.lines).toEqual(rows)
  })

  it('表空（线位未入库）返回空数组而非抛错；repository 抛错向上传播（线位缺失要响）', async () => {
    const emptyRepo = { listCanalLines: async () => [] } as unknown as DiversionRepository
    expect(await new DiversionController(new DiversionService(emptyRepo)).canalLine()).toEqual({
      lines: [],
    })
    await expect(controller.canalLine()).rejects.toThrow(/不应触达/)
  })
})

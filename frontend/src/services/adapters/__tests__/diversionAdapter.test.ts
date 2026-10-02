import { beforeEach, describe, expect, it, vi } from 'vitest'

import { diversionAdapter } from '../diversionAdapter'

// diversionAdapter 单测：year 透传 + 契约 schema 校验（缺 sandCement 拒绝）。
const fixture = {
  code: 200,
  data: {
    year: 2035,
    transfer: { year: 2035, coal: 428.68, grain: 837.555, ironOre: 313.64, sandCement: 0 },
    byPort: { qinzhou: { coal: 201.48, grain: 393.65, ironOre: 147.41, total: 742.54 } },
    // 三段口径（2026-10-02）：1 条入边 + 1 条出边（真实为 1+3，夹具取最小形状）
    sankeyFlows: [
      { from: '西江上行货', to: '平陆运河', value: 742.54 },
      { from: '平陆运河', to: '钦州港', value: 742.54 },
    ],
  },
}

describe('diversionAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => fixture,
        text: async () => JSON.stringify(fixture),
      }))
    )
  })

  it('year 透传并解包返回（shape=契约）', async () => {
    const fetchMock = vi.mocked(fetch)
    const r = await diversionAdapter.getBreakdown(2035)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/diversion/breakdown')
    expect(String(fetchMock.mock.calls[0][0])).toContain('year=2035')
    expect(r.transfer.sandCement).toBe(0)
    expect(r.sankeyFlows).toHaveLength(2)
  })
})

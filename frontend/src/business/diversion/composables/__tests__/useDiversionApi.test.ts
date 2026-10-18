import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useDiversionApi } from '../useDiversionApi'

const HERE = dirname(fileURLToPath(import.meta.url))

// useDiversionApi 单测（原 diversionAdapter.test.ts 迁移）：year 透传 + 契约 schema 校验。
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

describe('useDiversionApi', () => {
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
    const { getBreakdown } = useDiversionApi()
    const fetchMock = vi.mocked(fetch)
    const r = await getBreakdown(2035)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/diversion/breakdown')
    expect(String(fetchMock.mock.calls[0][0])).toContain('year=2035')
    expect(r.transfer.sandCement).toBe(0)
    expect(r.sankeyFlows).toHaveLength(2)
  })

  it('getCanalLine 请求 /diversion/canal-line 并经 schema 解包（退化几何拒绝即抛）', async () => {
    const envelope = {
      code: 200,
      data: {
        lines: [
          {
            name: '平陆运河（示意线）',
            section: '起点-平塘江口',
            coordinates: [
              [109.29, 22.7],
              [108.62, 21.87],
            ],
          },
        ],
      },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => envelope,
        text: async () => JSON.stringify(envelope),
      }))
    )
    const { getCanalLine } = useDiversionApi()
    const fetchMock = vi.mocked(fetch)
    const r = await getCanalLine()
    expect(String(fetchMock.mock.calls[0][0])).toContain('/diversion/canal-line')
    expect(r.lines[0].coordinates[0]).toEqual([109.29, 22.7])
  })
})

/**
 * 公开面收窄 — diversionAdapter 不得再存在（必要性审判波次二·单元 E）。
 * 判据输入受版本控制（源文件 + barrel），不读工作树脏件；相对深度按本测试文件自身目录算
 * （__tests__ → composables → diversion → business → src，共四层）。
 */
describe('公开面收窄 — diversionAdapter 不得再存在', () => {
  const RETIRED = '../../../../services/adapters/diversionAdapter.ts'

  it('🔴 services 公开面不再提供 diversionAdapter，取数只在业务 composable', async () => {
    const services = (await import('@/services')) as unknown as Record<string, unknown>
    expect(services.diversionAdapter).toBeUndefined()
    // 阳性对照：同层其它导出仍在（判据真的在看这张表）
    expect(typeof services.mapDataService).toBe('object')
  })

  it('adapter 文件已删（retired 路径必须不存在）', () => {
    expect(existsSync(resolve(HERE, RETIRED))).toBe(false)
  })
})

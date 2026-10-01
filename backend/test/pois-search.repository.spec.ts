import { describe, expect, it, vi } from 'vitest'

import { PoiSearchRepository } from '../src/modules/route/repositories/pois-search.repository'

// 2026-09-30 自 site-analysis.repository.spec 迁入（POI 搜索迁 route 域，迁测同笔）。
// 断言「哪些表进了查询」与 limit/关键词参数化——单表回退或漏表会立刻红。

function makeRepo(query: ReturnType<typeof vi.fn>) {
  return new PoiSearchRepository({ query } as never)
}

describe('PoiSearchRepository — searchPois 多源点集（自 site-analysis 迁入）', () => {
  it('SQL 覆盖四个真实点集（ports/flood_facilities/xiaoqu/poi_facilities）', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const repo = makeRepo(query)
    await repo.searchPois('', 50)
    const sql = String(query.mock.calls[0][0])
    for (const table of ['ports', 'flood_facilities', 'xiaoqu', 'poi_facilities']) {
      expect(sql).toContain(`FROM ${table}`)
    }
    // 来源标签列 + 坐标 4326 口径（4490 只存储不流通）
    expect(sql).toContain('AS source')
    expect(sql).toContain('ST_X(ST_Transform(geom, 4326))')
  })

  it('keyword 为空 → 名称条件传 NULL（一条 SQL 走完全部分支，无动态拼接）', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const repo = makeRepo(query)
    await repo.searchPois('   ', 50)
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0][1]).toEqual([null, 50])
  })

  it('keyword 有值 → ILIKE 参数化（%kw%），不拼进 SQL 文本', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const repo = makeRepo(query)
    await repo.searchPois(' 港 ', 30)
    expect(query.mock.calls[0][1]).toEqual(['%港%', 30])
    expect(String(query.mock.calls[0][0])).not.toContain('港')
  })

  it('limit 钳制 1..200；0/NaN 视为未提供 → 缺省 50', async () => {
    const cases: Array<[number, number]> = [
      [0, 50],
      [Number.NaN, 50],
      [-5, 1],
      [9999, 200],
      [37, 37],
    ]
    for (const [input, expected] of cases) {
      const query = vi.fn().mockResolvedValue({ rows: [] })
      await makeRepo(query).searchPois('', input)
      expect(query.mock.calls[0][1]).toEqual([null, expected])
    }
  })

  it('行 → 契约映射：source 透传、name/type/city 的 NULL 归一为空串', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'p1',
          name: null,
          type: null,
          source: 'port',
          city: null,
          district: null,
          lng: 108.6,
          lat: 21.7,
        },
      ],
    })
    const items = await makeRepo(query).searchPois('', 10)
    expect(items).toEqual([
      {
        id: 'p1',
        name: '',
        type: '',
        source: 'port',
        city: '',
        district: null,
        lng: 108.6,
        lat: 21.7,
      },
    ])
  })
})

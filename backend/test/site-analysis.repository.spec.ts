import { describe, expect, it, vi } from 'vitest'

import { DbService } from '../src/infra/db/db.service'
import {
  DEFAULT_CITY,
  getAvailableCities,
  isSupportedCity,
  SiteAnalysisRepository,
} from '../src/modules/site-analysis/repositories/site-analysis.repository'

// 数据源切 PostGIS 后的 repository 契约测试（取代原 DataFilesService 文件映射语义）：
// 城市白名单 / 非法 city 回落默认城市 / 类型白名单 / SQL 参数化（type/city 入参不拼接）
// / 未知类型不发 SQL。数据一致性由全量对账保证（六类逐类 count 相等，小区 2456 对 2456）。

function makeRepo(mockQuery: ReturnType<typeof vi.fn>): SiteAnalysisRepository {
  return new SiteAnalysisRepository({
    query: mockQuery,
  } as unknown as DbService)
}

describe('SiteAnalysisRepository — 城市白名单与 PostGIS 查询', () => {
  it('isSupportedCity：仅 qz/bh/fcg 为真（防注入面收口在白名单）', () => {
    expect(isSupportedCity('qz')).toBe(true)
    expect(isSupportedCity('bh')).toBe(true)
    expect(isSupportedCity('fcg')).toBe(true)
    expect(isSupportedCity('../../etc/passwd')).toBe(false)
    expect(isSupportedCity(undefined)).toBe(false)
    expect(isSupportedCity(null)).toBe(false)
  })

  it('getAvailableCities：返回副本，外部改动不污染白名单', () => {
    const cities = getAvailableCities()
    cities.push('hack')
    expect(getAvailableCities()).toEqual(['qz', 'bh', 'fcg'])
    expect(DEFAULT_CITY).toBe('qz')
  })

  it('getAvailableTypes：6 类设施（与 poi_facilities.type 值域子集一致，剔除 xiaoqu/port_pier）', () => {
    const repo = makeRepo(vi.fn())
    expect(repo.getAvailableTypes()).toEqual([
      'hospital',
      'primary_school',
      'middle_school',
      'park',
      'bus_station',
      'mall',
    ])
  })

  it('findByType：非法 city 回落默认城市 qz（参数化传参，不抛错）', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const repo = makeRepo(query)
    await repo.findByType('hospital', '../secrets')
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0][1]).toEqual(['hospital', 'qz'])
  })

  it('findByType：合法 city 进查询参数；未知类型返回 null 且不发 SQL', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const repo = makeRepo(query)
    await repo.findByType('mall', 'bh')
    expect(query.mock.calls[0][1]).toEqual(['mall', 'bh'])

    query.mockClear()
    expect(await repo.findByType('airport', 'qz')).toBeNull()
    expect(query).not.toHaveBeenCalled()
  })

  it('findXiaoqu：按 city 参数查询 xiaoqu 表', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const repo = makeRepo(query)
    await repo.findXiaoqu('fcg')
    expect(query.mock.calls[0][1]).toEqual(['fcg'])
    expect(String(query.mock.calls[0][0])).toContain('FROM xiaoqu')
  })

  it('findByType：SQL 固定查 poi_facilities 并以 ST_Transform(4326) 后拆经纬度（4490 只存储不流通）', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const repo = makeRepo(query)
    await repo.findByType('park', 'qz')
    const sql = String(query.mock.calls[0][0])
    expect(sql).toContain('FROM poi_facilities')
    expect(sql).toContain('ST_X(ST_Transform(geom, 4326))')
    expect(sql).toContain('ST_Y(ST_Transform(geom, 4326))')
    expect(sql).not.toContain('ST_X(geom)')
  })
})

// 多源搜索契约（2026-09-12 用户反馈「可选点太少」）：原实现只查 poi_facilities 一张表，
// 现改为 UNION 四个真实点集（港口/淹没设施点/小区/POI）并按来源优先级排序。
// 这里断言"哪些表进了查询"与 limit/关键词参数化——单表回退或漏表会立刻红。
describe('SiteAnalysisRepository — searchPois 多源点集', () => {
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

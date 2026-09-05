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

  it('findByType：SQL 固定查 poi_facilities 并以 ST_X/ST_Y 拆经纬度', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const repo = makeRepo(query)
    await repo.findByType('park', 'qz')
    const sql = String(query.mock.calls[0][0])
    expect(sql).toContain('FROM poi_facilities')
    expect(sql).toContain('ST_X(geom)')
    expect(sql).toContain('ST_Y(geom)')
  })
})

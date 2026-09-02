import { describe, expect, it, vi } from 'vitest'

import { DataFilesService } from '../src/infra/files/data-files.service'
import {
  DEFAULT_CITY,
  getAvailableCities,
  isSupportedCity,
  SiteAnalysisRepository,
} from '../src/modules/site-analysis/repositories/site-analysis.repository'

// 移植 Express facilitiesRepository 语义（无同名单测，按源码契约补）：
// 城市白名单防路径穿越 / 非法 city 回落默认城市 / 文件映射 / 类型清单剔除 xiaoqu /
// 读缓存命中只读一次磁盘（TTL + LRU 由 DataFilesService 统一提供）

function makeRepo(mockReadFile: ReturnType<typeof vi.fn>): SiteAnalysisRepository {
  return new SiteAnalysisRepository(
    new DataFilesService(mockReadFile as unknown as (p: string) => Promise<string>)
  )
}

describe('SiteAnalysisRepository — 城市白名单与文件映射', () => {
  it('isSupportedCity：仅 qz/bh/fcg 为真（防路径穿越）', () => {
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

  it('getAvailableTypes：6 类设施，剔除 xiaoqu（小区不参与设施选择）', () => {
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

  it('findByType：非法 city 回落默认城市 qz（不抛错，选址是纯计算接口）', async () => {
    const readFile = vi.fn().mockResolvedValue('[]')
    const repo = makeRepo(readFile)
    await repo.findByType('hospital', '../secrets')
    expect(readFile).toHaveBeenCalledTimes(1)
    expect(readFile.mock.calls[0][0]).toContain('site-selection')
    expect(readFile.mock.calls[0][0]).toContain('qz_hospital.json')
  })

  it('findByType：合法 city 走对应文件；未知类型返回 null 且不读盘', async () => {
    const readFile = vi.fn().mockResolvedValue('[]')
    const repo = makeRepo(readFile)
    await repo.findByType('mall', 'bh')
    expect(readFile.mock.calls[0][0]).toContain('bh_mall.json')

    readFile.mockClear()
    expect(await repo.findByType('airport', 'qz')).toBeNull()
    expect(readFile).not.toHaveBeenCalled()
  })

  it('findXiaoqu：三城各自文件名正确', async () => {
    const readFile = vi.fn().mockResolvedValue('[]')
    const repo = makeRepo(readFile)
    await repo.findXiaoqu('fcg')
    expect(readFile.mock.calls[0][0]).toContain('fcg_xiaoqu.json')
  })

  it('读缓存：同一路径两次读取只读一次磁盘（TTL 内命中缓存）', async () => {
    const readFile = vi.fn().mockResolvedValue('[{"lng":108.6,"lat":21.85}]')
    const repo = makeRepo(readFile)
    await repo.findByType('hospital', 'qz')
    await repo.findByType('hospital', 'qz')
    expect(readFile).toHaveBeenCalledTimes(1)
  })
})

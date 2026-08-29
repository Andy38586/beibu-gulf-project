/**
 * mapDataService 港口静态数据加载回归防线（2026-08-29 ports 自后端回迁前端后重写）：
 * 原 z033 信封解包测试随 /api/ports 透传端点删除而失效——loadStatic 直读静态 JSON 无信封。
 * 本文件锁定：静态加载 + zod schema 边界 + 北部湾 CRS 守卫 + TTL 缓存清理。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// mock 全局 fetch，隔离网络；loadStatic 走 res.json()（非 text()），mock 需配套
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { mapDataService } from '../mapDataService'

function mockJsonResponse(body: unknown) {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  // loadStatic 模块级 TTL 缓存会跨测试污染（首测 ports 被缓存，后续测试拿到旧值）
  mapDataService.clearCache()
})

describe('mapDataService 港口静态数据加载', () => {
  it('getPorts: 直读静态数组并返回', async () => {
    mockJsonResponse([
      { id: '000001', name: '北海港', address: '银滩旅游区18号', lng: 109.13, lat: 21.41 },
      { id: '000002', name: '钦州港', address: '勒沟西大街', lng: 108.59, lat: 21.72 },
    ])

    const ports = await mapDataService.getPorts()
    expect(Array.isArray(ports)).toBe(true)
    expect(ports).toHaveLength(2)
    expect(ports[0].name).toBe('北海港')
  })

  it('getPorts: 越界坐标被 CRS 守卫过滤', async () => {
    mockJsonResponse([
      { id: 'ok', name: '钦州港', address: '勒沟西大街', lng: 108.59, lat: 21.72 },
      { id: 'bad', name: '越界港', address: '境外', lng: 200, lat: 100 }, // 北部湾外
    ])

    const ports = await mapDataService.getPorts()
    expect(ports.map((p) => p.id)).toEqual(['ok'])
  })

  it('getPorts: 格式错误（非数组）应抛友好错误', async () => {
    mockJsonResponse({ not: 'array' })

    await expect(mapDataService.getPorts()).rejects.toThrow('港口数据格式不正确')
  })

  it('getPorts: 缺必填字段（schema 校验失败）同样抛友好错误', async () => {
    mockJsonResponse([{ id: 'x', name: '无坐标港' }])

    await expect(mapDataService.getPorts()).rejects.toThrow('港口数据格式不正确')
  })

  it('clearCache 后重新发起请求（TTL 缓存已失效）', async () => {
    mockJsonResponse([{ id: '1', name: '第一版港', address: 'a', lng: 108.5, lat: 21.5 }])
    const first = await mapDataService.getPorts()
    expect(first[0].name).toBe('第一版港')

    mapDataService.clearCache()
    mockJsonResponse([{ id: '1', name: '第二版港', address: 'a', lng: 108.5, lat: 21.5 }])
    const second = await mapDataService.getPorts()
    expect(second[0].name).toBe('第二版港')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

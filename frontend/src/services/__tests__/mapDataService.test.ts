/**
 * mapDataService 信封解包测试（z033 根修回归防线）
 * 背景：mapDataService 用原生 fetch（保留 TTL 缓存/去重/超时），
 * 后端统一返回 { code, data } 信封。此前不解包 → getPorts 收到 object
 * → Array.isArray 失败 → 港口 + 行政区划（同 try 块连带）都不显示。
 * 本测试锁定：fetchData 对信封的解包行为 + getPorts 返回数组。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// mock 全局 fetch，隔离网络；apiRequest 走 res.text() 解析（非 json()），mock 需配套
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { mapDataService } from '../mapDataService'

/** 构造与真实 fetch Response 同构的 mock（apiRequest 使用 res.text() 再 JSON.parse） */
function mockResponse(body: unknown) {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  // 模块级 TTL 缓存会跨测试污染（首测 ports 被缓存，后续测试拿到旧值）
  mapDataService.clearCache()
})

describe('mapDataService 信封解包（z033）', () => {
  it('getPorts: 后端 {code,data} 信封应解包为数组', async () => {
    mockResponse({
      code: 200,
      data: [
        { id: '000001', name: '北海港', address: '银滩旅游区18号', lng: 109.13, lat: 21.41 },
        { id: '000002', name: '钦州港', address: '勒沟西大街', lng: 108.59, lat: 21.72 },
      ],
    })

    const ports = await mapDataService.getPorts()
    expect(Array.isArray(ports)).toBe(true)
    expect(ports).toHaveLength(2)
    expect(ports[0].name).toBe('北海港')
  })

  it('getPorts: 非信封（直接数组）也应兼容', async () => {
    mockResponse([
      { id: '000001', name: '北海港', address: '银滩旅游区18号', lng: 109.13, lat: 21.41 },
    ])

    const ports = await mapDataService.getPorts()
    expect(Array.isArray(ports)).toBe(true)
    expect(ports).toHaveLength(1)
  })

  it('getPorts: 越界坐标被 CRS 守卫过滤', async () => {
    mockResponse({
      code: 200,
      data: [
        { id: 'ok', name: '钦州港', address: '勒沟西大街', lng: 108.59, lat: 21.72 },
        { id: 'bad', name: '越界港', address: '境外', lng: 200, lat: 100 }, // 北部湾外
      ],
    })

    const ports = await mapDataService.getPorts()
    expect(ports.map((p) => p.id)).toEqual(['ok'])
  })

  it('getPorts: 格式错误（非数组）应抛友好错误', async () => {
    mockResponse({ code: 200, data: { not: 'array' } })

    await expect(mapDataService.getPorts()).rejects.toThrow('港口数据格式不正确')
  })

  it('getPorts: 带扩展字段的 3 键信封 {code,data,message} 仍应解包为数组 (REQ-1)', async () => {
    mockResponse({
      code: 200,
      data: [
        { id: '000001', name: '北海港', address: '银滩旅游区18号', lng: 109.13, lat: 21.41 },
        { id: '000002', name: '钦州港', address: '勒沟西大街', lng: 108.59, lat: 21.72 },
      ],
      message: 'ok',
    })

    const ports = await mapDataService.getPorts()
    expect(Array.isArray(ports)).toBe(true)
    expect(ports).toHaveLength(2)
  })
})

import { describe, expect, it, vi } from 'vitest'

import { BusinessError } from '../src/common/errors/business-error'
import { TaskHandlers } from '../src/modules/task/services/task-handlers'
import { TASK_DOMAINS } from '../src/modules/task/types/task'

// S1 的「委托接线」测试。
//
// 🔴 为什么必须有这一层：task.e2e-spec.ts 为了确定性把 `TaskHandlers.get` 换成了 stub，
// 于是**「handler 里到底调了哪个 service 方法、参数对不对」完全没有被测到**。
// 而这里恰恰是最容易写错的地方（参数顺序、参数名、必填校验），且错了会静默跑出错误结果
//（如 route-path 参数名写成 startLng ⇒ business 层报 INVALID_PARAMS，用户只看到"任务失败"）。
//
// 做法：用 vi.fn() 造四个业务 service 的假实现，直接 new TaskHandlers，断言调用形状。
// 不依赖 Nest DI、不依赖数据库 ⇒ 快且确定。

function build() {
  const floodService = { getFloodAreas: vi.fn().mockResolvedValue({ features: [] }) }
  const routeService = { findPath: vi.fn().mockResolvedValue({ found: true }) }
  const siteAnalysisService = { analyze: vi.fn().mockResolvedValue({ score: 1 }) }
  const forecastService = { getTimeSeriesData: vi.fn().mockResolvedValue({ series: [] }) }

  const handlers = new TaskHandlers(
    floodService as never,
    routeService as never,
    siteAnalysisService as never,
    forecastService as never
  )
  return { handlers, floodService, routeService, siteAnalysisService, forecastService }
}

describe('TaskHandlers 委托接线', () => {
  it('支持域与 TASK_DOMAINS 单源一致，且每个域都能取到执行器', () => {
    const { handlers } = build()
    // 🔴 不断言手写字面量：断言「handler 表 == TASK_DOMAINS」这一不变量，
    // 新增域只需改 TASK_DOMAINS 一处，漏配 handler 或漏进白名单都会在此变红。
    expect([...handlers.supportedDomains].sort()).toEqual([...TASK_DOMAINS].sort())
    for (const domain of handlers.supportedDomains) {
      expect(typeof handlers.get(domain)).toBe('function')
    }
  })

  it('未知域取执行器直接抛 BusinessError（不返回 undefined 让队列空转）', () => {
    const { handlers } = build()
    expect(() => handlers.get('nope' as never)).toThrow(BusinessError)
  })

  describe('flood-areas', () => {
    it('把 waterLevel 转成字符串传给 FloodService.getFloodAreas', async () => {
      const { handlers, floodService } = build()
      await handlers.get('flood-areas')({ waterLevel: 2.5 })
      expect(floodService.getFloodAreas).toHaveBeenCalledWith('2.5')
    })

    it('waterLevel 缺省时传 undefined（取全部档位）', async () => {
      const { handlers, floodService } = build()
      await handlers.get('flood-areas')({})
      expect(floodService.getFloodAreas).toHaveBeenCalledWith(undefined)
    })

    it('waterLevel 为 null 也视作缺省', async () => {
      const { handlers, floodService } = build()
      await handlers.get('flood-areas')({ waterLevel: null })
      expect(floodService.getFloodAreas).toHaveBeenCalledWith(undefined)
    })
  })

  describe('route-path', () => {
    it('🔴 参数名必须是 fromLng/fromLat/toLng/toLat（对齐 route.controller）', async () => {
      const { handlers, routeService } = build()
      await handlers.get('route-path')({
        fromLng: 108.62,
        fromLat: 21.95,
        toLng: 108.35,
        toLat: 21.75,
        mode: 'time',
      })
      expect(routeService.findPath).toHaveBeenCalledWith({
        fromLng: 108.62,
        fromLat: 21.95,
        toLng: 108.35,
        toLat: 21.75,
        mode: 'time',
      })
    })

    it('mode 缺省传 undefined（由 service 决定默认 distance）', async () => {
      const { handlers, routeService } = build()
      await handlers.get('route-path')({ fromLng: 1, fromLat: 2, toLng: 3, toLat: 4 })
      expect(routeService.findPath).toHaveBeenCalledWith({
        fromLng: 1,
        fromLat: 2,
        toLng: 3,
        toLat: 4,
        mode: undefined,
      })
    })

    it('数字型字符串可被接受（前端 JSON 里可能传成字符串）', async () => {
      const { handlers, routeService } = build()
      await handlers.get('route-path')({
        fromLng: '108.62',
        fromLat: '21.95',
        toLng: '108.35',
        toLat: '21.75',
      })
      expect(routeService.findPath).toHaveBeenCalledWith(
        expect.objectContaining({ fromLng: 108.62, toLat: 21.75 })
      )
    })

    it('缺参数 / 非数字参数 ⇒ BusinessError（INVALID_PARAMS）', async () => {
      const { handlers, routeService } = build()
      await expect(
        handlers.get('route-path')({ fromLng: 1, fromLat: 2, toLng: 3 })
      ).rejects.toThrow(/toLat/)
      await expect(
        handlers.get('route-path')({ fromLng: 'abc', fromLat: 2, toLng: 3, toLat: 4 })
      ).rejects.toThrow(BusinessError)
      expect(routeService.findPath).not.toHaveBeenCalled()
    })

    it('mode 非字符串时传 undefined 而非把对象塞进去', async () => {
      const { handlers, routeService } = build()
      await handlers.get('route-path')({
        fromLng: 1,
        fromLat: 2,
        toLng: 3,
        toLat: 4,
        mode: { evil: true },
      })
      expect(routeService.findPath).toHaveBeenCalledWith(
        expect.objectContaining({ mode: undefined })
      )
    })
  })

  describe('site-analysis', () => {
    it('参数体原样透传给 SiteAnalysisService.analyze（🔴 不改选址口径）', async () => {
      const { handlers, siteAnalysisService } = build()
      const params = {
        selectedKeys: ['port', 'road'],
        typeSettings: { port: { importance: 5, radius: 2000 } },
        weights: { distance: 3 },
        city: 'beihai',
      }
      await handlers.get('site-analysis')(params)
      expect(siteAnalysisService.analyze).toHaveBeenCalledWith(params)
    })
  })

  describe('forecast-timeseries', () => {
    it('🔴 按 getTimeSeriesData(indicator, portId, start, end, granularity, confidence) 的位置传参', async () => {
      const { handlers, forecastService } = build()
      await handlers.get('forecast-timeseries')({
        indicator: 'cargo',
        portId: 'P01',
        start: '2020-01',
        end: '2025-12',
        granularity: 'year',
        confidence: 0.9,
      })
      expect(forecastService.getTimeSeriesData).toHaveBeenCalledWith(
        'cargo',
        'P01',
        '2020-01',
        '2025-12',
        'year',
        0.9
      )
    })

    it('可选参数缺省传 undefined；confidence 缺省为 1.0', async () => {
      const { handlers, forecastService } = build()
      await handlers.get('forecast-timeseries')({ indicator: 'container' })
      expect(forecastService.getTimeSeriesData).toHaveBeenCalledWith(
        'container',
        undefined,
        undefined,
        undefined,
        undefined,
        1.0
      )
    })

    it('缺 indicator ⇒ BusinessError', async () => {
      const { handlers, forecastService } = build()
      await expect(handlers.get('forecast-timeseries')({})).rejects.toThrow(/indicator/)
      expect(forecastService.getTimeSeriesData).not.toHaveBeenCalled()
    })

    it('confidence 非法值回落 1.0（不把 NaN 传进 service）', async () => {
      const { handlers, forecastService } = build()
      await handlers.get('forecast-timeseries')({ indicator: 'cargo', confidence: 'abc' })
      expect(forecastService.getTimeSeriesData).toHaveBeenCalledWith(
        'cargo',
        undefined,
        undefined,
        undefined,
        undefined,
        1.0
      )
    })
  })
})

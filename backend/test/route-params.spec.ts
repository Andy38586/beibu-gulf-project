import { describe, expect, it, vi } from 'vitest'

import { BusinessError, ErrorCode } from '../src/common/errors/business-error'
import { RouteController } from '../src/modules/route/controllers/route.controller'
import { readRouteCoords } from '../src/modules/route/utils/route-params'

// W07：同步端点 route.controller 与异步任务域 task-handlers 此前各写一份坐标解析，
// 前者裸 Number() 会把 NaN 静默传给下游（表现为「查询结果为空」而不是「参数错误」）。
// 本套用例钉住「同一口径 + 非法即 400」。
describe('route 坐标参数解析（同步/异步同源）', () => {
  const makeController = () => {
    const findPath = vi.fn(async () => ({ ok: true }))
    const controller = new RouteController({ findPath } as never, { searchPois: vi.fn() } as never)
    return { controller, findPath }
  }

  it('合法四参解析为 number 并透传（含 mode）', async () => {
    const { controller, findPath } = makeController()
    await controller.findPath({
      fromLng: '108.1',
      fromLat: '21.5',
      toLng: '108.4',
      toLat: '21.8',
      mode: 'time',
    })
    expect(findPath).toHaveBeenCalledWith({
      fromLng: 108.1,
      fromLat: 21.5,
      toLng: 108.4,
      toLat: 21.8,
      mode: 'time',
    })
  })

  it('🔴 缺参数时抛 400，不把 NaN 传给下游', () => {
    const { controller, findPath } = makeController()
    // findPath 是同步方法：解析失败即抛（Nest 会转成 400），不是返回 rejected promise
    expect(() => controller.findPath({ fromLng: '108.1' })).toThrow(BusinessError)
    expect(findPath).not.toHaveBeenCalled()
  })

  it('🔴 非数字参数时业务码为 400001', () => {
    const { controller, findPath } = makeController()
    let caught: unknown
    try {
      // 断言的是「解析阶段同步抛」——readRouteCoords 在 service 调用之前求值，
      // 所以这里拿不到 promise 可 await。void 是显式声明「不等待返回值」，
      // 不是把 promise 吞掉：真要是异步 reject，catch 抓不到、下面两条断言会红。
      void controller.findPath({ fromLng: 'abc', fromLat: '21.5', toLng: '108.4', toLat: '21.8' })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(BusinessError)
    expect((caught as BusinessError).bizCode).toBe(ErrorCode.INVALID_PARAMS.code)
    expect((caught as BusinessError).status).toBe(400)
    expect(findPath).not.toHaveBeenCalled()
  })

  it('空串与 null 同样判非法（同语义的另两种记法）', () => {
    expect(() => readRouteCoords({ fromLng: '', fromLat: 1, toLng: 2, toLat: 3 })).toThrow(
      BusinessError
    )
    expect(() => readRouteCoords({ fromLng: null, fromLat: 1, toLng: 2, toLat: 3 })).toThrow(
      BusinessError
    )
  })
})

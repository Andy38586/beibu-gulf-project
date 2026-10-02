import { describe, expect, it } from 'vitest'

import {
  EMPTY_ROUTE_READINESS,
  getRouteReadiness,
  isRoutePreparing,
  notifyRouteReadiness,
  registerRouteReadiness,
  routeReadinessVersion,
} from '../routeReadiness'

// 判据钉的是**口径**，不是"有没有这个函数"：
// 三个条件（要 3D / 渲染器还没 3D / 期望仍是 3D）任一被摘掉，对应用例必红。

describe('isRoutePreparing（3D 路由「准备中」判据）', () => {
  it('🔴 3D 路由 + 渲染器还没到 3D + 期望仍是 3D ⇒ 准备中', () => {
    expect(isRoutePreparing('3d', '2d', '3d')).toBe(true)
    expect(isRoutePreparing('3d', null, '3d')).toBe(true)
  })

  it('🔴 渲染器已是 3D（缓存命中/二次进入）⇒ 不准备：环不闪一下', () => {
    expect(isRoutePreparing('3d', '3d', '3d')).toBe(false)
  })

  it('🔴 切换失败被回滚（期望引擎已不是 3D）⇒ 不准备：环不会永远呼吸', () => {
    expect(isRoutePreparing('3d', '2d', '2d')).toBe(false)
  })

  it('🔴 2D 路由恒不准备（本次只针对 3D 路由）', () => {
    expect(isRoutePreparing('2d', '2d', '2d')).toBe(false)
    expect(isRoutePreparing('2d', null, '3d')).toBe(false)
    expect(isRoutePreparing(undefined, '2d', '3d')).toBe(false)
  })
})

describe('routeReadiness 注入通道（与 taskIndicator 同款）', () => {
  it('未注入时按空态返回（不抛错、不返回 undefined）', () => {
    expect(getRouteReadiness('/whatever')).toEqual(EMPTY_ROUTE_READINESS)
  })

  it('注入后按路由取值；notify 递增版本号（core 靠它重算）', () => {
    const before = routeReadinessVersion.value
    registerRouteReadiness((p) => ({ preparing: p === '/flood-analysis' }))
    expect(getRouteReadiness('/flood-analysis')).toEqual({ preparing: true })
    expect(getRouteReadiness('/forecast')).toEqual({ preparing: false })
    expect(routeReadinessVersion.value).toBeGreaterThan(before)

    const mid = routeReadinessVersion.value
    notifyRouteReadiness()
    expect(routeReadinessVersion.value).toBe(mid + 1)
  })
})

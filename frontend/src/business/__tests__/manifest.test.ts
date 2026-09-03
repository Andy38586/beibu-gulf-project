import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useForecastStore } from '@/stores'

import { businessModules, runBusinessLogoutReset } from '../manifest'

/**
 * manifest → 登出重置注册映射单测。
 * 新增业务模块只需在清单补 reset，App.vue/登出链路零改动——此测试锁住"已实现模块必须声明 reset、
 * 占位模块可省略、批量执行真实复位"三条不变量。
 */
describe('business/manifest 登出重置注册', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('已实现业务模块均声明 reset（登出重置）', () => {
    const implemented = businessModules.filter((m) => m.component !== null)
    expect(implemented.map((m) => m.name).sort()).toEqual([
      'FloodAnalysis',
      'Forecast',
      'RouteAnalysis',
      'SiteSelection',
    ])
    for (const m of implemented) {
      expect(m.reset, `${m.name} 缺少登出 reset`).toBeDefined()
    }
  })

  it('RouteAnalysis 已实现（组件非 null、注册路由、声明 reset）', () => {
    const route = businessModules.find((m) => m.name === 'RouteAnalysis')
    expect(route).toBeDefined()
    expect(route?.component).not.toBeNull()
    expect(route?.navDisabled).toBeUndefined()
    expect(route?.reset).toBeDefined()
  })

  it('runBusinessLogoutReset 批量执行不抛错，且 Forecast 运行时状态复位', () => {
    const forecast = useForecastStore()
    forecast.currentTime = '2027-01' // 人为改写
    expect(() => runBusinessLogoutReset()).not.toThrow()
    expect(forecast.currentTime).toBe('2026-06') // reset() 的默认值
  })

  it('可重复执行（登出多次无障碍）', () => {
    expect(() => {
      runBusinessLogoutReset()
      runBusinessLogoutReset()
    }).not.toThrow()
  })
})

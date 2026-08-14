import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useForecastStore } from '../forecastStore'

/**
 * useForecastStore 单测
 * 实施计划 08 文档未给出 forecastState 的测试代码，此处按真实 store 实现
 * （frontend/src/stores/forecastState.ts）补齐全测，覆盖：
 * - 初始状态默认值
 * - setCurrentTime / setActiveIndicator / setTimeGranularity
 * - setConfidenceThreshold / clearCache
 * - reset 恢复默认
 * 2026-08-10（面试报告 P0-3）：cacheData 零调用已删，相关用例一并移除
 * 2026-08-14（F-7）：dataCache/currentData 死状态移除，断言同步删除
 */
describe('useForecastStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('初始状态', () => {
    it('应有合理默认值', () => {
      const store = useForecastStore()
      expect(store.currentTime).toBe('2026-06')
      expect(store.timeRange.start).toBe('2021-01')
      expect(store.timeRange.end).toBe('2031-12')
      expect(store.activeIndicator).toBe('cargo')
      expect(store.isPlaying).toBe(false)
      expect(store.requestCache.size).toBe(0)
    })
  })

  describe('setCurrentTime', () => {
    it('应更新当前时间（不影响 timeRange.current）', () => {
      const store = useForecastStore()
      store.setCurrentTime('2030-06')
      expect(store.currentTime).toBe('2030-06')
      expect(store.timeRange.current).toBe('2026-06')
    })
  })

  describe('setActiveIndicator', () => {
    it('应切换激活指标', () => {
      const store = useForecastStore()
      store.setActiveIndicator('berth')
      expect(store.activeIndicator).toBe('berth')
    })
  })

  describe('setTimeGranularity', () => {
    it('应更新时间粒度', () => {
      const store = useForecastStore()
      store.setTimeGranularity('year')
      expect(store.timeGranularity).toBe('year')
    })
  })

  describe('setConfidenceThreshold', () => {
    it('应更新对应指标的置信度阈值', () => {
      const store = useForecastStore()
      store.setConfidenceThreshold('berth', 0.9)
      expect(store.confidenceThresholds.berth).toBe(0.9)
    })
  })

  describe('reset', () => {
    it('应恢复默认状态', () => {
      const store = useForecastStore()
      store.setCurrentTime('2030-01')
      store.setActiveIndicator('traffic')

      store.reset()

      expect(store.currentTime).toBe('2026-06')
      expect(store.activeIndicator).toBe('cargo')
      expect(store.requestCache.size).toBe(0)
      expect(store.confidenceThresholds.cargo).toBe(0.8)
    })
  })

  describe('事务状态 (b039)', () => {
    it('初始 activeTransactionId=0, isRequesting=false', () => {
      const store = useForecastStore()
      expect(store.activeTransactionId).toBe(0)
      expect(store.isRequesting).toBe(false)
    })

    it('resetTransactionState 复位事务 ID 与 isRequesting', () => {
      const store = useForecastStore()
      store.activeTransactionId = 5
      store.isRequesting = true
      store.resetTransactionState()
      expect(store.activeTransactionId).toBe(0)
      expect(store.isRequesting).toBe(false)
    })

    it('reset() 也复位事务状态（与批次1 Part 6 联动）', () => {
      const store = useForecastStore()
      store.activeTransactionId = 99
      store.isRequesting = true
      store.reset()
      expect(store.activeTransactionId).toBe(0)
      expect(store.isRequesting).toBe(false)
    })
  })
})

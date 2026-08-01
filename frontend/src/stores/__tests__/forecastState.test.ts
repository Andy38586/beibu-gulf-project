import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ForecastSeries } from '@/types/api/forecast'

import { useForecastState } from '../forecastState'

/**
 * 构造最小合法的 ForecastSeries，仅用于 store 行为测试。
 * 实施计划 03 将 cacheData 入参收窄为 ForecastSeries，
 * 故测试数据须符合该结构（不再使用任意对象）。
 */
function makeSeries(indicator: string): ForecastSeries {
  return {
    indicator,
    unit: '万吨',
    data: {
      qinzhou: {
        historical: [{ time: '2025-12', value: 1, type: 'historical' }],
      },
    },
  }
}

/**
 * useForecastState 单测
 *
 * 实施计划 08 文档未给出 forecastState 的测试代码，此处按真实 store 实现
 * （frontend/src/stores/forecastState.ts）补齐全测，覆盖：
 * - 初始状态默认值
 * - setCurrentTime / setActiveIndicator / setTimeGranularity
 * - cacheData + currentData（按 currentTime 派生的计算属性）
 * - setConfidenceThreshold / clearCache
 * - reset 恢复默认
 */
describe('useForecastState', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('初始状态', () => {
    it('应有合理默认值', () => {
      const store = useForecastState()
      expect(store.currentTime).toBe('2026-06')
      expect(store.timeRange.start).toBe('2021-01')
      expect(store.timeRange.end).toBe('2031-12')
      expect(store.activeIndicator).toBe('cargo')
      expect(store.isPlaying).toBe(false)
      expect(store.currentData).toBeNull()
    })
  })

  describe('setCurrentTime', () => {
    it('应更新当前时间（不影响 timeRange.current）', () => {
      const store = useForecastState()
      store.setCurrentTime('2030-06')
      expect(store.currentTime).toBe('2030-06')
      expect(store.timeRange.current).toBe('2026-06')
    })
  })

  describe('setActiveIndicator', () => {
    it('应切换激活指标', () => {
      const store = useForecastState()
      store.setActiveIndicator('berth')
      expect(store.activeIndicator).toBe('berth')
    })
  })

  describe('setTimeGranularity', () => {
    it('应更新时间粒度', () => {
      const store = useForecastState()
      store.setTimeGranularity('year')
      expect(store.timeGranularity).toBe('year')
    })
  })

  describe('cacheData / currentData', () => {
    it('应按当前时间暴露缓存数据', () => {
      const store = useForecastState()
      const payload = makeSeries('cargo')
      store.cacheData('2026-06', payload)
      expect(store.dataCache.get('2026-06')).toEqual(payload)
      expect(store.currentData).toEqual(payload)
    })

    it('未缓存当前时间时 currentData 为 null', () => {
      const store = useForecastState()
      store.cacheData('2030-01', makeSeries('berth'))
      expect(store.currentData).toBeNull()
    })
  })

  describe('setConfidenceThreshold', () => {
    it('应更新对应指标的置信度阈值', () => {
      const store = useForecastState()
      store.setConfidenceThreshold('berth', 0.9)
      expect(store.confidenceThresholds.berth).toBe(0.9)
    })
  })

  describe('clearCache', () => {
    it('应清空数据缓存', () => {
      const store = useForecastState()
      store.cacheData('2026-06', makeSeries('cargo'))
      store.clearCache()
      expect(store.currentData).toBeNull()
      expect(store.dataCache.size).toBe(0)
    })
  })

  describe('reset', () => {
    it('应恢复默认状态', () => {
      const store = useForecastState()
      store.setCurrentTime('2030-01')
      store.setActiveIndicator('traffic')
      store.cacheData('2030-01', makeSeries('berth'))

      store.reset()

      expect(store.currentTime).toBe('2026-06')
      expect(store.activeIndicator).toBe('cargo')
      expect(store.currentData).toBeNull()
      expect(store.confidenceThresholds.cargo).toBe(0.8)
    })
  })
})

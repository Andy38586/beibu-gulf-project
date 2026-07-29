import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import type { FloodFeature, FloodStatistics } from '@/types/business/base'

import { useFloodState } from '../floodState'

/**
 * useFloodState 单测
 *
 * 覆盖工厂化（Setup Store）后的核心 API：
 * - 初始状态
 * - startFloodAnalysis
 * - saveState / consumeState（跨页面持久化快照）
 * - clearState
 *
 * 经核对：本测试断言与真实 store 实现（frontend/src/stores/floodState.ts）一致。
 */
describe('useFloodState', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('初始状态', () => {
    it('应为无分析数据', () => {
      const store = useFloodState()
      expect(store.floodActive).toBe(false)
      expect(store.floodStatistics).toBeNull()
      expect(store.hasAnalysisData).toBe(false)
      expect(store.hasPersistedState).toBe(false)
    })
  })

  describe('startFloodAnalysis', () => {
    it('应正确设置分析数据', () => {
      const store = useFloodState()
      const stats: FloodStatistics = { totalArea: 1000, riskLevel: '低', affectedCount: 5 }
      const features: FloodFeature[] = []

      store.startFloodAnalysis(stats, features, '低')

      expect(store.floodActive).toBe(true)
      expect(store.showFloodArea).toBe(true)
      expect(store.floodStatistics).toEqual(stats)
      expect(store.hasAnalysisData).toBe(true)
    })
  })

  describe('saveState / consumeState', () => {
    it('应正确保存和恢复状态', () => {
      const store = useFloodState()
      const stats: FloodStatistics = { totalArea: 2000, riskLevel: '中', affectedCount: 10 }

      store.saveState({
        waterLevel: 5,
        floodStatistics: stats,
        floodFeatures: [],
        floodRiskLevel: '中',
        affectedFacilities: [],
        totalLoss: 100,
      })

      expect(store.hasPersistedState).toBe(true)

      const consumed = store.consumeState()
      expect(consumed).not.toBeNull()
      expect(consumed!.waterLevel).toBe(5)
      expect(consumed!.totalLoss).toBe(100)

      // consume 后标志应清除
      expect(store.hasPersistedState).toBe(false)
      // 再次 consume 应返回 null
      expect(store.consumeState()).toBeNull()
    })
  })

  describe('clearState', () => {
    it('应彻底重置所有状态', () => {
      const store = useFloodState()
      store.startFloodAnalysis({ totalArea: 100, riskLevel: '低', affectedCount: 1 }, [], '低')
      store.saveState({
        waterLevel: 3,
        floodStatistics: null,
        floodFeatures: [],
        floodRiskLevel: '低',
        affectedFacilities: [],
        totalLoss: 0,
      })

      store.clearState()

      expect(store.floodActive).toBe(false)
      expect(store.floodStatistics).toBeNull()
      expect(store.hasPersistedState).toBe(false)
    })
  })
})

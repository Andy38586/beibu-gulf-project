// floodStore 激活标志回归测试（R-7 / LIF-3，P3：三 store 已并入）
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useFloodStore } from '@/stores'
import type { AffectedFacility } from '@/types/business/base'

/**
 * LIF-3 验收：*Active 标志单向置位
 * 三个 setter 必须在「有值」与「空/无效值」时都显式同步 active，
 * 不再依赖 resetXxx 手动纠正（原实现只在有值时置 true，空值残留旧激活态）。
 */
describe('LIF-3 *Active 单向置位', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('floodStore.setPortImpactResult', () => {
    it('有设施时 portImpactActive=true', () => {
      const store = useFloodStore()
      store.setPortImpactResult([{ id: 'f1' } as unknown as AffectedFacility], 100)
      expect(store.portImpactActive).toBe(true)
    })

    it('空数组时 portImpactActive=false（修正：原只在有值时置 true）', () => {
      const store = useFloodStore()
      store.setPortImpactResult([{ id: 'f1' } as unknown as AffectedFacility], 50)
      expect(store.portImpactActive).toBe(true)
      // 后续清空为旧值，active 应同步 false，不残留
      store.setPortImpactResult([], 0)
      expect(store.portImpactActive).toBe(false)
      expect(store.affectedFacilities).toEqual([])
      expect(store.totalLoss).toBe(0)
    })
  })

  describe('floodStore.setWaterLevel', () => {
    it('水位>0 时 waterLevelActive=true', () => {
      const store = useFloodStore()
      store.setWaterLevel(3)
      expect(store.waterLevelActive).toBe(true)
    })

    it('setWaterLevel(0) 时 waterLevelActive=false（修正）', () => {
      const store = useFloodStore()
      store.setWaterLevel(3)
      expect(store.waterLevelActive).toBe(true)
      store.setWaterLevel(0)
      expect(store.waterLevelActive).toBe(false)
      expect(store.waterLevel).toBe(0)
    })
  })
})

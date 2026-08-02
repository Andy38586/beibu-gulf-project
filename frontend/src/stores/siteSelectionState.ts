import { defineStore } from 'pinia'

import type { FacilityPoint, TypeSetting } from '@/types/facility'
import type { ScoredXiaoqu } from '@/types/xiaoqu'

import { createPersistedState } from './factories/createPersistedState'

export interface SiteSelectionState {
  factorSettings: Record<string, TypeSetting> | null
  matchedXiaoqu: ScoredXiaoqu[]
  selectedTypes: string[]
  currentPlanId: string | null
  savedXiaoquIds: string[]
  facilityPoi: Record<string, FacilityPoint[]>
}

/**
 * 选址分析跨页面状态 store
 *
 * 使用 createPersistedState 工厂提供统一的 saveState/consumeState/clearState API。
 * 快照数据整体存储于 persistedState，不再分散到各业务字段。
 */
export const useSiteSelectionStateStore = defineStore('siteSelectionState', () => {
  const persisted = createPersistedState<SiteSelectionState>()

  return {
    hasPersistedState: persisted.hasPersistedState,
    saveState: persisted.saveState,
    consumeState: persisted.consumeState,
    clearState: persisted.clearPersistedState,
  }
})

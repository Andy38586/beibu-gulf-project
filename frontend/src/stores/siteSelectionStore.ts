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
 * 选址分析跨页面状态持久化：模块级单例（模块变量天然单例，无业务状态，无需 Pinia），
 * App.vue 登出清理与选址页保存/恢复共享同一快照。
 */
const persisted = createPersistedState<SiteSelectionState>()

export const siteSelectionPersisted = {
  hasPersistedState: persisted.hasPersistedState,
  saveState: persisted.saveState,
  consumeState: persisted.consumeState,
  clearState: persisted.clearPersistedState,
}

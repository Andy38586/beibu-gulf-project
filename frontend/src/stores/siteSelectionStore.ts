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
 * 选址分析跨页面状态持久化（2026-08-08 空壳去化）
 * 原为 Pinia defineStore 纯透传 createPersistedState 的空壳（无业务状态，
 * 共享语义仅靠 Pinia 单例）——改为模块级单例（模块变量天然单例），
 * 功能完全等价：App.vue 登出清理与 SiteSelectionPage 保存/恢复共享同一快照。
 */
const persisted = createPersistedState<SiteSelectionState>()

export const siteSelectionPersisted = {
  hasPersistedState: persisted.hasPersistedState,
  saveState: persisted.saveState,
  consumeState: persisted.consumeState,
  clearState: persisted.clearPersistedState,
}

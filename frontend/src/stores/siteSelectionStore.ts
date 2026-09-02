import { defineStore } from 'pinia'
import { ref } from 'vue'

import type { FacilityPoint, TypeSetting } from '@/types/facility'
import type { ScoredXiaoqu } from '@/types/xiaoqu'

import { createPersistedState } from './factories/createPersistedState'

export interface SiteSelectionState {
  factorSettings: Record<string, TypeSetting> | null
  matchedXiaoqu: ScoredXiaoqu[]
  selectedTypes: string[]
  facilityPoi: Record<string, FacilityPoint[]>
}

/**
 * 选址分析跨页面状态 store（Pinia，与 flood/forecast 状态管理范式统一）：
 * - 跨页面持久化（saveState/consumeState/clearState）走 createPersistedState 内存快照工厂；
 * - 请求进行态（calculating/calcError）也迁入 store，供请求 composable 与页面共享（对齐 forecast）。
 * App.vue 登出清理与选址页保存/恢复共享同一 store 实例。
 */
export const useSiteSelectionStore = defineStore('site-selection', () => {
  // ─── 请求进行态 ──────────────────────────────────────────
  const calculating = ref(false)
  const calcError = ref('')

  // ─── 分析结果（页面运行时状态） ──────────────────────────
  const matchedXiaoqu = ref<ScoredXiaoqu[]>([])
  const selectedTypes = ref<string[]>([])
  const facilityPoi = ref<Record<string, FacilityPoint[]>>({})

  // ─── 跨页面持久化（工厂） ────────────────────────────────
  const persisted = createPersistedState<SiteSelectionState>()

  /** 保存当前状态到快照（跳转登录时由页面 onBeforeRouteLeave 调用） */
  function saveState(payload: SiteSelectionState): void {
    persisted.saveState(payload)
  }

  /** 消费已保存的状态（一次性，返回后快照清空） */
  function consumeState(): SiteSelectionState | null {
    return persisted.consumeState()
  }

  /**
   * 写入分析结果（页面 handleResult / 快照恢复时调用）。
   * 此前 matchedXiaoqu/selectedTypes/facilityPoi 仅被 clearState 清空、从未写入（死状态）——
   * AppLayout 全局雷达图需消费同源数据，统一经此写入。
   */
  function setResult(result: {
    matchedXiaoqu: ScoredXiaoqu[]
    selectedTypes: string[]
    facilityPoi: Record<string, FacilityPoint[]>
  }): void {
    matchedXiaoqu.value = result.matchedXiaoqu
    selectedTypes.value = result.selectedTypes
    facilityPoi.value = result.facilityPoi
  }

  /** 彻底清除（登出 / 离开页面） */
  function clearState(): void {
    persisted.clearPersistedState()
    matchedXiaoqu.value = []
    selectedTypes.value = []
    facilityPoi.value = {}
    calcError.value = ''
    // 复位请求进行态（原遗漏致登出后下次进页「分析中」spinner 常驻）
    calculating.value = false
  }

  /** 请求进行态 action（composable 不再直改 state） */
  function setCalculating(v: boolean): void {
    calculating.value = v
  }

  /** 请求错误态 action（同上） */
  function setCalcError(v: string): void {
    calcError.value = v
  }

  return {
    // 请求进行态
    calculating,
    calcError,
    // 分析结果
    matchedXiaoqu,
    selectedTypes,
    facilityPoi,
    setResult,
    setCalculating,
    setCalcError,
    // 跨页面持久化
    hasPersistedState: persisted.hasPersistedState,
    saveState,
    consumeState,
    clearState,
  }
})

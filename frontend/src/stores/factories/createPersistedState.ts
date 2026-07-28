import { ref } from 'vue'
import type { Ref } from 'vue'

/**
 * 跨页面持久化状态工厂
 *
 * 提炼自 siteSelectionState / floodState 共同的 saveState/consumeState/clearState 模式。
 * 业务 store 通过组合此工厂获得统一的持久化 API，避免重复样板代码。
 *
 * 语义：
 * - saveState(data): 写入快照，标记 hasPersistedState = true
 * - consumeState(): 读取并清除快照（一次性消费），返回 null 表示无快照
 * - clearPersistedState(): 清除快照和标志
 *
 * @example
 * ```ts
 * export const useMyStore = defineStore('my', () => {
 *   const persisted = createPersistedState<MyState>()
 *   return { ...persisted, clearState: persisted.clearPersistedState }
 * })
 * ```
 */
export function createPersistedState<T>() {
  const hasPersistedState: Ref<boolean> = ref(false)
  const persistedState: Ref<T | null> = ref(null)

  function saveState(data: T): void {
    persistedState.value = data
    hasPersistedState.value = true
  }

  function consumeState(): T | null {
    if (!hasPersistedState.value) return null
    const state = persistedState.value
    hasPersistedState.value = false
    persistedState.value = null
    return state
  }

  function clearPersistedState(): void {
    hasPersistedState.value = false
    persistedState.value = null
  }

  return {
    hasPersistedState,
    persistedState,
    saveState,
    consumeState,
    clearPersistedState,
  }
}

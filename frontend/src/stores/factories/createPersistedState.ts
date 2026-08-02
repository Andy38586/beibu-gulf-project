import type { Ref } from 'vue'
import { ref } from 'vue'

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
 * 语义澄清（DAT-6）：
 * - 本工厂是 Pinia 内存级快照，存活范围为「同标签页内路由导航之间」，刷新/关闭即失；
 *   与 mapStore 的 sessionStorage 方案语义不同——本工厂不落任何浏览器存储。
 * - consumeState 为一次性消费：第二次调用返回 null（快照已被清空）。
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

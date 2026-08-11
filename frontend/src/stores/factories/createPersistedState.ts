import type { Ref } from 'vue'
import { ref } from 'vue'

/**
 * 跨页面持久化状态工厂：提炼选址/洪涝/预测三 store 共同的 saveState/consumeState/clearState
 * 模式，避免重复样板代码。
 * 注意：这是内存级快照，存活于「同标签页路由导航之间」，刷新即失，不落任何浏览器存储；
 * consumeState 一次性消费，第二次调用返回 null。
 * 用法：`const persisted = createPersistedState<MyState>()` 后组合进 store。
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

import { ref, type Ref } from 'vue'

/**
 * 请求事务计数器（forecast / siteSuitability 两 store 同款）：
 * 请求 composable 以返回值标记本轮请求，过期响应据此丢弃；
 * 归零由各 store 自身的 reset/重置流程处理（语义随 store 不同，不收口）。
 */
export function createTransactionId(): {
  activeTransactionId: Ref<number>
  bumpTransactionId: () => number
} {
  const activeTransactionId = ref(0)

  function bumpTransactionId(): number {
    activeTransactionId.value += 1
    return activeTransactionId.value
  }

  return { activeTransactionId, bumpTransactionId }
}

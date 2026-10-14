/**
 * useSiteSuitabilityRequest — 选址模块请求事务管理器。
 * 事务骨架与 useForecastRequest 同源（跨域 `useTransactionGuard`）：一次评价任务的请求共享
 * 同一事务 ID，新事务自动取消旧请求（AbortController 透传），事务过期静默丢弃响应；
 * AbortController 由本实例持有，不进 store。
 *
 * 与预测域的差异是**行为核心**，故不抽公共：
 *   ① 本域**不**托管 store.isRequesting —— loading 的唯一写入口在 useSiteSuitabilityLayer
 *     （缓存命中 / 新旧事务交错时口径与预测域不同）；
 *   ② 取消的判据是"事务已失效"（任何错误），而非特定 ApiError 码。
 */
import { useTransactionGuard } from '@/shared'
import { useSiteSuitabilityStore } from '@/stores'

interface UseSiteSuitabilityRequestReturn {
  startTransaction: () => { transactionId: number; signal: AbortSignal }
  isTransactionValid: (transactionId: number) => boolean
  runInTransaction: <T>(adapterFn: () => Promise<T>, transactionId: number) => Promise<T | null>
  cancelAll: () => void
}

export function useSiteSuitabilityRequest(): UseSiteSuitabilityRequestReturn {
  const state = useSiteSuitabilityStore()
  const { startTransaction, isTransactionValid, cancelRequest } = useTransactionGuard(state)

  async function runInTransaction<T>(
    adapterFn: () => Promise<T>,
    transactionId: number
  ): Promise<T | null> {
    if (!isTransactionValid(transactionId)) return null
    try {
      const result = await adapterFn()
      if (!isTransactionValid(transactionId)) return null
      return result
    } catch (e) {
      // 事务已失效时的任何错误（含新事务 abort 旧请求）静默返回 null，避免误弹 toast
      if (!isTransactionValid(transactionId)) return null
      throw e
    }
  }

  function cancelAll() {
    cancelRequest()
  }

  return { startTransaction, isTransactionValid, runInTransaction, cancelAll }
}

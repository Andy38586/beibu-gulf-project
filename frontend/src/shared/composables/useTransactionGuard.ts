/**
 * useTransactionGuard — 事务骨架（跨域公共）：一次任务的请求共享同一事务 ID，
 * 新事务自动取消旧请求（AbortController 由本实例持有，不进 store）。
 *
 * 只收口两域**逐字一致**的部分：事务 ID 推进、signal 派生、有效性判定、取消。
 * `runInTransaction` 的差异（是否托管 isRequesting、哪些错误算"取消"）是**行为核心**，
 * 留在各域自己的 composable 里 —— 抽成配置项只会让读者更难分辨两域口径（铁律 5）。
 */
import { useLatestRequest } from './useLatestRequest'

/** 事务状态所在 store 的最小面（预测 / 选址两 store 均满足） */
export interface TransactionStore {
  readonly activeTransactionId: number
  bumpTransactionId(): number
}

export interface UseTransactionGuardReturn {
  startTransaction: () => { transactionId: number; signal: AbortSignal }
  isTransactionValid: (transactionId: number) => boolean
  /** 取消在途请求（AbortController 由本 guard 持有）；各域 cancelAll 的公共底座 */
  cancelRequest: () => void
}

export function useTransactionGuard(store: TransactionStore): UseTransactionGuardReturn {
  const { createSignal, cancel: cancelRequest } = useLatestRequest()

  /** 状态变化前调用：生成新事务 ID 与 signal（旧事务的 signal 由 useLatestRequest 一并 abort） */
  function startTransaction() {
    return { transactionId: store.bumpTransactionId(), signal: createSignal() }
  }

  /** 事务是否仍为最新（ID 未过期） */
  function isTransactionValid(transactionId: number): boolean {
    return transactionId === store.activeTransactionId
  }

  return { startTransaction, isTransactionValid, cancelRequest }
}

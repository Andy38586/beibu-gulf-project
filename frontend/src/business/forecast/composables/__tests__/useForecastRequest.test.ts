import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, ErrorCode } from '@/shared'
import { useForecastStore } from '@/stores/forecastStore'

import { useForecastRequest } from '../useForecastRequest'

/**
 * useForecastRequest 单测（覆盖率方案①：业务 composable 抽测）
 *
 * 覆盖核心事务状态机：
 * - startTransaction：递增事务 ID、取消旧请求
 * - isTransactionValid：事务有效性判断
 * - runInTransaction：成功/事务过期/取消静默/真实错误抛出/finally 复位
 * - cancelAll：取消 + store 事务状态复位
 */
describe('useForecastRequest', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  describe('startTransaction', () => {
    it('递增 activeTransactionId 并返回 signal', () => {
      const { startTransaction } = useForecastRequest()
      const store = useForecastStore()

      expect(store.activeTransactionId).toBe(0)
      const t1 = startTransaction()
      expect(t1.transactionId).toBe(1)
      expect(t1.signal).toBeInstanceOf(AbortSignal)

      const t2 = startTransaction()
      expect(t2.transactionId).toBe(2)
    })

    it('新事务取消旧事务的未完成请求（abort 旧 controller）', () => {
      const { startTransaction } = useForecastRequest()
      const t1 = startTransaction()
      // 第二次 startTransaction 后,第一个事务的 signal 应已 abort
      const t2 = startTransaction()
      expect(t1.signal.aborted).toBe(true)
      expect(t2.signal.aborted).toBe(false)
    })
  })

  describe('isTransactionValid', () => {
    it('当前事务 ID 有效,过期 ID 无效', () => {
      const { startTransaction, isTransactionValid } = useForecastRequest()
      const t1 = startTransaction()
      expect(isTransactionValid(t1.transactionId)).toBe(true)

      startTransaction()
      expect(isTransactionValid(t1.transactionId)).toBe(false)
    })
  })

  describe('runInTransaction', () => {
    it('事务有效时执行 adapterFn 并返回结果,isRequesting 复位', async () => {
      const { startTransaction, runInTransaction } = useForecastRequest()
      const store = useForecastStore()
      const t = startTransaction()

      const adapterFn = vi.fn().mockResolvedValue({ ok: true })
      const result = await runInTransaction(adapterFn, t.transactionId)

      expect(adapterFn).toHaveBeenCalledTimes(1)
      expect(result).toEqual({ ok: true })
      expect(store.isRequesting).toBe(false)
    })

    it('事务已过期时直接返回 null,不调用 adapterFn', async () => {
      const { startTransaction, runInTransaction } = useForecastRequest()
      const t = startTransaction()
      startTransaction() // 使 t 过期

      const adapterFn = vi.fn().mockResolvedValue({ ok: true })
      const result = await runInTransaction(adapterFn, t.transactionId)

      expect(result).toBeNull()
      expect(adapterFn).not.toHaveBeenCalled()
    })

    it('await 期间事务失效时返回 null（新事务抢占）', async () => {
      const { startTransaction, runInTransaction } = useForecastRequest()
      const t = startTransaction()

      let resolveAdapter: (v: unknown) => void
      const pending = new Promise((resolve) => {
        resolveAdapter = resolve
      })
      const adapterFn = vi.fn().mockReturnValue(pending)

      const promise = runInTransaction(adapterFn, t.transactionId)
      // adapter 在途时发起新事务 → 旧事务失效
      startTransaction()
      resolveAdapter!({ ok: true })

      const result = await promise
      expect(result).toBeNull()
    })

    it('被取消（TIMEOUT + 事务失效）时静默返回 null', async () => {
      const { startTransaction, runInTransaction } = useForecastRequest()
      const t = startTransaction()

      const adapterFn = vi
        .fn()
        .mockRejectedValue(new ApiError('timeout', ErrorCode.TIMEOUT))
      const promise = runInTransaction(adapterFn, t.transactionId)
      startTransaction() // await 前使事务失效

      const result = await promise
      expect(result).toBeNull()
    })

    it('事务仍有效时的真实错误照常抛出', async () => {
      const { startTransaction, runInTransaction } = useForecastRequest()
      const t = startTransaction()

      const adapterFn = vi
        .fn()
        .mockRejectedValue(new ApiError('bad request', ErrorCode.REQUEST_FAILED))

      await expect(runInTransaction(adapterFn, t.transactionId)).rejects.toThrow('bad request')
    })

    it('异常路径 finally 复位 isRequesting', async () => {
      const { startTransaction, runInTransaction } = useForecastRequest()
      const store = useForecastStore()
      const t = startTransaction()

      const adapterFn = vi.fn().mockRejectedValue(new Error('boom'))
      await expect(runInTransaction(adapterFn, t.transactionId)).rejects.toThrow('boom')
      expect(store.isRequesting).toBe(false)
    })
  })

  describe('cancelAll', () => {
    it('取消在途请求并复位 store 事务状态', () => {
      const { startTransaction, cancelAll } = useForecastRequest()
      const store = useForecastStore()

      const t = startTransaction()
      store.isRequesting = true

      cancelAll()

      expect(t.signal.aborted).toBe(true)
      expect(store.activeTransactionId).toBe(0)
      expect(store.isRequesting).toBe(false)
    })
  })

  describe('isLoading', () => {
    it('透传 store 的 isRequesting', async () => {
      const { startTransaction, runInTransaction, isLoading } = useForecastRequest()
      const t = startTransaction()

      let resolveAdapter: (v: unknown) => void
      const pending = new Promise((resolve) => {
        resolveAdapter = resolve
      })
      const promise = runInTransaction(vi.fn().mockReturnValue(pending), t.transactionId)
      expect(isLoading.value).toBe(true)

      resolveAdapter!({ ok: true })
      await promise
      expect(isLoading.value).toBe(false)
    })
  })
})

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSiteSuitabilityStore } from '@/stores/siteSuitabilityStore'

import { useSiteSuitabilityRequest } from '../useSiteSuitabilityRequest'

/**
 * useSiteSuitabilityRequest 单测（本件此前无直接测试；随 C5 事务骨架收口补，作安全网）
 * 覆盖：startTransaction / isTransactionValid / runInTransaction（成功·过期·取消·真实错误）/ cancelAll。
 */
describe('useSiteSuitabilityRequest', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('startTransaction：递增 activeTransactionId、返回 signal、新事务 abort 旧 signal', () => {
    const { startTransaction } = useSiteSuitabilityRequest()
    const store = useSiteSuitabilityStore()

    expect(store.activeTransactionId).toBe(0)
    const t1 = startTransaction()
    expect(t1.transactionId).toBe(1)
    expect(t1.signal).toBeInstanceOf(AbortSignal)

    const t2 = startTransaction()
    expect(t2.transactionId).toBe(2)
    expect(t1.signal.aborted).toBe(true)
    expect(t2.signal.aborted).toBe(false)
  })

  it('isTransactionValid：当前有效、过期无效', () => {
    const { startTransaction, isTransactionValid } = useSiteSuitabilityRequest()
    const t1 = startTransaction()
    expect(isTransactionValid(t1.transactionId)).toBe(true)
    startTransaction()
    expect(isTransactionValid(t1.transactionId)).toBe(false)
  })

  it('runInTransaction：有效时执行并返回结果；过期时不调 adapterFn、返回 null', async () => {
    const { startTransaction, runInTransaction } = useSiteSuitabilityRequest()
    const t = startTransaction()

    const fn = vi.fn().mockResolvedValue({ ok: true })
    expect(await runInTransaction(fn, t.transactionId)).toEqual({ ok: true })

    const stale = t.transactionId
    startTransaction()
    const fn2 = vi.fn().mockResolvedValue({ ok: false })
    expect(await runInTransaction(fn2, stale)).toBeNull()
    expect(fn2).not.toHaveBeenCalled()
  })

  it('runInTransaction：await 期间事务失效 ⇒ 返回 null（新事务抢占）', async () => {
    const { startTransaction, runInTransaction } = useSiteSuitabilityRequest()
    const t = startTransaction()

    let resolveAdapter: (v: unknown) => void
    const pending = new Promise((resolve) => {
      resolveAdapter = resolve
    })
    const promise = runInTransaction(vi.fn().mockReturnValue(pending), t.transactionId)
    startTransaction()
    resolveAdapter!({ ok: true })

    expect(await promise).toBeNull()
  })

  it('runInTransaction：事务失效时的任意错误（含 abort）静默返回 null', async () => {
    const { startTransaction, runInTransaction } = useSiteSuitabilityRequest()
    const t = startTransaction()

    const promise = runInTransaction(
      vi.fn().mockRejectedValue(new Error('aborted')),
      t.transactionId
    )
    startTransaction()
    expect(await promise).toBeNull()
  })

  it('runInTransaction：事务仍有效时的真实错误照常抛出', async () => {
    const { startTransaction, runInTransaction } = useSiteSuitabilityRequest()
    const t = startTransaction()
    const fn = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(runInTransaction(fn, t.transactionId)).rejects.toThrow('boom')
  })

  it('cancelAll：abort 在途 signal', () => {
    const { startTransaction, cancelAll } = useSiteSuitabilityRequest()
    const t = startTransaction()
    cancelAll()
    expect(t.signal.aborted).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'

import { useLatestRequest } from '../useLatestRequest'

/**
 * useLatestRequest 单测（2026-08-08 请求封装统一）
 * 覆盖竞态守卫核心行为：新请求取消旧、isLatest 判断、cancel 清理。
 */
describe('useLatestRequest', () => {
  it('createSignal 返回新 signal，且新请求会 abort 旧请求', () => {
    const { createSignal } = useLatestRequest()
    const first = createSignal()
    expect(first.aborted).toBe(false)

    const second = createSignal()
    expect(first.aborted).toBe(true)
    expect(second.aborted).toBe(false)
  })

  it('isLatest：只有最新 signal 返回 true，被替换的旧 signal 返回 false', () => {
    const { createSignal, isLatest } = useLatestRequest()
    const first = createSignal()
    expect(isLatest(first)).toBe(true)

    const second = createSignal()
    expect(isLatest(second)).toBe(true)
    expect(isLatest(first)).toBe(false)
  })

  it('cancel 取消在途请求，此后 isLatest 恒为 false（无在途请求）', () => {
    const { createSignal, isLatest, cancel } = useLatestRequest()
    const signal = createSignal()
    cancel()

    expect(signal.aborted).toBe(true)
    expect(isLatest(signal)).toBe(false)
  })

  it('多个实例相互独立（组件各自持有自己的竞态上下文）', () => {
    const a = useLatestRequest()
    const b = useLatestRequest()

    const sigA = a.createSignal()
    const sigB = b.createSignal()

    // 各自最新
    expect(a.isLatest(sigA)).toBe(true)
    expect(b.isLatest(sigB)).toBe(true)
    // 跨实例不干扰
    expect(sigA.aborted).toBe(false)
    expect(sigB.aborted).toBe(false)
  })
})

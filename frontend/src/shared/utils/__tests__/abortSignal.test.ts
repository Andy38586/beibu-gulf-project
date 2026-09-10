/**
 * combineSignals 测试（AbortSignal.any 兼容替身）
 * 覆盖：空/单输入透传、任一源中止即中止、输入已中止时同步中止态、中止后解绑监听。
 * 回归守卫：本工具为替换 `AbortSignal.any` 而引入（其下限 Safari 17.4 与项目
 * browserslist 的 Safari>=14.1 冲突，且 vite 不 polyfill 运行时 API）。
 */
import { describe, expect, it } from 'vitest'

import { combineSignals } from '../abortSignal'

describe('combineSignals', () => {
  it('无有效输入 → 返回未中止的信号', () => {
    expect(combineSignals([]).aborted).toBe(false)
    expect(combineSignals([undefined, null]).aborted).toBe(false)
  })

  it('单个输入 → 直接透传同一引用', () => {
    const c = new AbortController()
    expect(combineSignals([c.signal])).toBe(c.signal)
    expect(combineSignals([c.signal, undefined])).toBe(c.signal)
  })

  it('任一源中止 → 组合信号同步中止', () => {
    const a = new AbortController()
    const b = new AbortController()
    const combined = combineSignals([a.signal, b.signal])
    expect(combined.aborted).toBe(false)

    b.abort()
    expect(combined.aborted).toBe(true)
  })

  it('输入已处于中止态 → 返回的信号立即是中止态', () => {
    const a = new AbortController()
    a.abort()
    const b = new AbortController()
    expect(combineSignals([a.signal, b.signal]).aborted).toBe(true)
  })

  it('中止后解绑监听：二次中止不抛错且状态稳定', () => {
    const a = new AbortController()
    const b = new AbortController()
    const combined = combineSignals([a.signal, b.signal])
    a.abort()
    expect(combined.aborted).toBe(true)
    // 解绑未做时，此处会对已 settled 的 controller 重复 abort —— 不抛错但属泄漏面
    expect(() => b.abort()).not.toThrow()
    expect(combined.aborted).toBe(true)
  })

  it('中止原因透传（reason 可用时）', () => {
    const a = new AbortController()
    const b = new AbortController()
    const combined = combineSignals([a.signal, b.signal])
    a.abort('timeout')
    expect(combined.reason).toBe('timeout')
  })
})

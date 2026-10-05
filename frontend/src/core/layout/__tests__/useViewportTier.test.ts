import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useViewportTier } from '../useViewportTier'

// useViewportTier 单测（v4-S10 / G4 收口）：三档 = layoutTierFor 单源派生，
// 经 useGCS 响应式入口（150ms 防抖）。window.innerWidth 在测试里由
// Object.defineProperty 改写（vitest 环境 jsdom），resize 后推进假定时器。

function setWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true, configurable: true })
  window.dispatchEvent(new Event('resize'))
  vi.advanceTimersByTime(150)
}

describe('useViewportTier（响应式三档 = useGCS().tier 派生）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // 先取一次，确保 useGCS 的模块级 resize 监听已注册（单例设计，常驻不拆）
    useViewportTier()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('≥960 desktop；640~959 drawer；<640 compact', () => {
    setWidth(1920)
    expect(useViewportTier().value).toBe('desktop')
    setWidth(1280)
    expect(useViewportTier().value).toBe('desktop')
    setWidth(800)
    expect(useViewportTier().value).toBe('drawer')
    setWidth(500)
    expect(useViewportTier().value).toBe('compact')
  })

  it('档位随 resize 事件响应式更新（同一实例连续变化）', () => {
    const tier = useViewportTier()
    setWidth(1024)
    expect(tier.value).toBe('desktop')
    setWidth(700)
    expect(tier.value).toBe('drawer')
    setWidth(375)
    expect(tier.value).toBe('compact')
    setWidth(1500)
    expect(tier.value).toBe('desktop')
  })
})

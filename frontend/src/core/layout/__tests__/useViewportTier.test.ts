import { describe, expect, it } from 'vitest'

import { useViewportTier } from '../useViewportTier'

// useViewportTier 单测（v4-S10）：三档断点（总纲 §9.2 对齐 config.ts 常量）。
// window.innerWidth 在测试里由 Object.defineProperty 改写（vitest 环境 jsdom）。

function setWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true, configurable: true })
  window.dispatchEvent(new Event('resize'))
}

describe('useViewportTier（响应式三档）', () => {
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

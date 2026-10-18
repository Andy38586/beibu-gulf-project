import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useGCS } from '@/shared'

// 断点档位单测（v4-S10 / G4 收口；波二删除 useViewportTier 别名层后改直测唯一响应式入口）：
// 档位唯一响应式入口 = useGCS().tier（模块级单例 resize + 150ms 防抖，判定唯一实现 =
// shared/layout/config.layoutTierFor）。window.innerWidth 在测试里由 Object.defineProperty
// 改写（vitest 环境 jsdom），resize 后推进假定时器。

const HERE = dirname(fileURLToPath(import.meta.url))

function setWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true, configurable: true })
  window.dispatchEvent(new Event('resize'))
  vi.advanceTimersByTime(150)
}

describe('断点档位（useGCS().tier = layoutTierFor 单源派生）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // 先取一次，确保 useGCS 的模块级 resize 监听已注册（单例设计，常驻不拆）
    useGCS()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('≥960 desktop；640~959 drawer；<640 compact', () => {
    setWidth(1920)
    expect(useGCS().tier.value).toBe('desktop')
    setWidth(1280)
    expect(useGCS().tier.value).toBe('desktop')
    setWidth(800)
    expect(useGCS().tier.value).toBe('drawer')
    setWidth(500)
    expect(useGCS().tier.value).toBe('compact')
  })

  it('档位随 resize 事件响应式更新（同一实例连续变化）', () => {
    const { tier } = useGCS()
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

// 波二（必要性审判）：useViewportTier 是 1 生产消费点的纯别名 ⇒ 已内联进 GCSPanel.vue。
describe('公开面收窄 — useViewportTier 别名层不得再存在', () => {
  it('别名源文件已删除（用 fs 判存在，静态 import 会直接炸编译）', () => {
    expect(existsSync(resolve(HERE, '../useViewportTier.ts'))).toBe(false)
  })

  it('@/shared 公开面不含 useViewportTier；useGCS 仍在（阳性对照）', async () => {
    const mod = (await import('@/shared')) as unknown as Record<string, unknown>
    expect(mod.useViewportTier, 'useViewportTier 应已内联删除').toBeUndefined()
    expect(typeof mod.useGCS).toBe('function')
  })
})

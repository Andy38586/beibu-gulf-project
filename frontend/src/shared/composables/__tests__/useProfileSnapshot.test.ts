import { describe, expect, it, vi } from 'vitest'

// isProfilePath 已收为模块内部（仅 useProfileSnapshot 消费）；改走公开面：
// 捕获注册的 onBeforeRouteLeave 回调，用 to.path 直接驱动。
const holder = vi.hoisted(() => ({
  leave: undefined as ((to: { path: string }) => void) | undefined,
}))

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: (fn: (to: { path: string }) => void) => {
    holder.leave = fn
  },
}))

import { useProfileSnapshot } from '../useProfileSnapshot'

function drive(path: string) {
  const save = vi.fn()
  const clear = vi.fn()
  holder.leave = undefined
  useProfileSnapshot({ save, clear })
  expect(holder.leave).toBeTypeOf('function')
  holder.leave!({ path })
  return { save, clear }
}

describe('useProfileSnapshot 守卫路径判定', () => {
  it('仅 /profile 判定为个人中心路径（触发 save）', () => {
    const { save, clear } = drive('/profile')
    expect(save).toHaveBeenCalledTimes(1)
    expect(clear).not.toHaveBeenCalled()
  })

  it('业务页与首页不是个人中心路径（触发 clear）', () => {
    expect(drive('/').clear).toHaveBeenCalledTimes(1)
    expect(drive('/forecast').clear).toHaveBeenCalledTimes(1)
  })

  it('按 path 比对（守卫消费的是 to.path，不含 query/hash）', () => {
    expect(drive('/profile?redirect=/forecast').clear).toHaveBeenCalledTimes(1)
    expect(drive('/profile#section').clear).toHaveBeenCalledTimes(1)
  })
})
// D3 去 export：isProfilePath 已收为模块内部；本组是「公开面收窄」本身的判据。
describe('公开面收窄 — isProfilePath 不得再导出', () => {
  const INTERNAL = ['isProfilePath']

  it('内部符号不在模块公开面；公开符号仍在（阳性对照）', async () => {
    const mod = (await import('../useProfileSnapshot')) as unknown as Record<string, unknown>
    for (const k of INTERNAL) expect(mod[k], k + ' 应已收为模块内部').toBeUndefined()
    expect(typeof mod.useProfileSnapshot).toBe('function')
  })
})

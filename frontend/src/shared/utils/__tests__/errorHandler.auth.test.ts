// @vitest-environment jsdom
/**
 * handleAuthError 认证失效引导单测：
 * 锁定「GCSModal login 模式引导 + 用户确认后带 redirect 落点个人中心」契约，
 * 防 401 引导路径回归成盲目踢回首页；已在个人中心时就地 toast 不弹 modal（面板可见不遮挡）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Router } from 'vue-router'

vi.mock('@/shared/composables/useAuth', () => ({
  useAuth: () => ({ logout: vi.fn().mockResolvedValue(undefined) }),
}))

import { handleAuthError } from '../errorHandler'
import { closeModal, gcsModalState, gcsToastState } from '../gcsFeedback'

function makeRouter(currentPath: string): Router & { push: ReturnType<typeof vi.fn> } {
  return {
    currentRoute: { value: { path: currentPath, fullPath: currentPath } },
    push: vi.fn(),
  } as unknown as Router & { push: ReturnType<typeof vi.fn> }
}

describe('handleAuthError（认证失效软引导）', () => {
  beforeEach(() => {
    closeModal()
    gcsToastState.items.length = 0
  })

  it('非个人中心页 401 → 弹 login modal 引导，确认后才带 redirect 落到 /profile', async () => {
    const router = makeRouter('/forecast')
    await handleAuthError(router as unknown as Router)
    // 引导语义：先弹 modal 征询，不盲目跳转
    expect(router.push).not.toHaveBeenCalled()
    expect(gcsModalState.visible).toBe(true)
    expect(gcsModalState.mode).toBe('login')
    // 模拟用户点击「去登录」→ 跳转个人中心并携带回跳参数
    gcsModalState.onConfirm?.()
    expect(router.push).toHaveBeenCalledWith({
      path: '/profile',
      query: { redirect: '/forecast' },
    })
  })

  it('已在个人中心 → 不弹 modal（登录面板就地可见），仅 toast 提示', async () => {
    const router = makeRouter('/profile')
    await handleAuthError(router as unknown as Router)
    expect(gcsModalState.visible).toBe(false)
    expect(router.push).not.toHaveBeenCalled()
    expect(gcsToastState.items.some((t) => t.message.includes('需要先登录'))).toBe(true)
  })

  it('全路径作为回跳参数保留（含 query 的深链可还原）', async () => {
    const router = makeRouter('/forecast')
    ;(router.currentRoute.value as unknown as { fullPath: string }).fullPath = '/forecast?a=1&b=2'
    await handleAuthError(router as unknown as Router)
    gcsModalState.onConfirm?.()
    expect(router.push).toHaveBeenCalledWith({
      path: '/profile',
      query: { redirect: '/forecast?a=1&b=2' },
    })
  })
})

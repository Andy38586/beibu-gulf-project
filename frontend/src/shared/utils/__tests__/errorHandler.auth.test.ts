// @vitest-environment jsdom
/**
 * handleAuthError 认证失效引导单测：
 * 锁定「落点个人中心未登录态（内嵌登录面板）+ 带 redirect 回跳参数」契约，
 * 防 401 引导路径回归成盲目踢回首页。
 */
import { describe, expect, it, vi } from 'vitest'
import type { Router } from 'vue-router'

vi.mock('@/shared/composables/useAuth', () => ({
  useAuth: () => ({ logout: vi.fn().mockResolvedValue(undefined) }),
}))

import { handleAuthError } from '../errorHandler'

function makeRouter(currentPath: string): Router & { push: ReturnType<typeof vi.fn> } {
  return {
    currentRoute: { value: { path: currentPath, fullPath: currentPath } },
    push: vi.fn(),
  } as unknown as Router & { push: ReturnType<typeof vi.fn> }
}

describe('handleAuthError（认证失效软引导）', () => {
  it('非个人中心页 401 → 清理认证态并带 redirect 落到 /profile', async () => {
    const router = makeRouter('/forecast')
    await handleAuthError(router as unknown as Router)
    expect(router.push).toHaveBeenCalledWith({
      path: '/profile',
      query: { redirect: '/forecast' },
    })
  })

  it('已在个人中心 → 不重复跳转（登录面板就地可见）', async () => {
    const router = makeRouter('/profile')
    await handleAuthError(router as unknown as Router)
    expect(router.push).not.toHaveBeenCalled()
  })

  it('全路径作为回跳参数保留（含 query 的深链可还原）', async () => {
    const router = makeRouter('/forecast')
    ;(router.currentRoute.value as unknown as { fullPath: string }).fullPath = '/forecast?a=1&b=2'
    await handleAuthError(router as unknown as Router)
    expect(router.push).toHaveBeenCalledWith({
      path: '/profile',
      query: { redirect: '/forecast?a=1&b=2' },
    })
  })
})

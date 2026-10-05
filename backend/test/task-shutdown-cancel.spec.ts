import { describe, expect, it } from 'vitest'

import { TaskHandlers } from '../src/modules/task/services/task-handlers'
import { TaskService } from '../src/modules/task/services/task.service'
import { ANONYMOUS_OWNER } from '../src/modules/task/types/task'

/**
 * 1004-04 三态取消判定（停机路径）回归：
 * `isCancelled` 原实现 `registry.get(id)?.status === 'cancelled'` 在**注册表已 dispose**
 * （条目 undefined）时返回 false ⇒ 在飞任务被判「未取消、继续跑」，失败后还会走完 3 次
 * 重试退避再报失败；而停机后这些副作用全是写给已清空的表（静默丢弃、拖慢退出）。
 * 修复后：undefined 与 'cancelled' 同判取消，重试链在第一次失败后的循环顶即返回。
 */
describe('TaskService 停机取消（三态判定）', () => {
  it('🔴 停机 dispose 后：在飞任务失败不再重试，handler 只跑一次', async () => {
    let calls = 0
    const handlers = {
      get: () => () => {
        calls += 1
        return Promise.reject(new Error('boom'))
      },
    } as unknown as TaskHandlers
    const service = new TaskService(handlers)

    service.submit({
      domain: 'flood-areas',
      route: '/a-analysis',
      ownerId: ANONYMOUS_OWNER,
      priority: 'normal',
      params: {},
    })
    // 让第一次执行发生并失败（失败后进入 300ms 重试退避）
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(calls).toBe(1)

    // SIGTERM 停机：onModuleDestroy → registry.dispose() 清表（条目变 undefined）
    service.onModuleDestroy()

    // 覆盖第一次重试退避（300ms）
    await new Promise((resolve) => setTimeout(resolve, 400))
    // 修前：undefined === 'cancelled' 为 false ⇒ 重试被放行，calls=2
    expect(calls).toBe(1)
  })
})

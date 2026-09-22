import { describe, expect, it } from 'vitest'

import { TaskHandlers } from '../src/modules/task/services/task-handlers'
import { TaskService } from '../src/modules/task/services/task.service'
import { TASK_MAX_WAIT_MS } from '../src/modules/task/types/task'

/**
 * 排队超时判定的**接线**回归测试（S1 交付时 `expireStalePending` 已实现但全仓零调用）。
 *
 * 为什么单独立一个文件：串行队列并发上限 1、容量 8，一个永不结束的在飞任务会把
 * 后面排队的全部压在 pending 上；没有这条判定，前端只能无限转圈、后端只能重启解。
 * 判据要成立的前提不是函数写得对，而是**有人按节拍调它**——所以本文件测的是接线后的
 * 端到端语义（提交 → 判超时 → 状态与队列位次都收口），而不只是函数返回值。
 */

/** 永不结束的 handler：模拟"占住队列的长任务" */
const blockingHandler = () => new Promise<never>(() => {})

function makeService(): TaskService {
  const handlers = {
    get: () => blockingHandler,
  } as unknown as TaskHandlers
  return new TaskService(handlers)
}

function submitOn(service: TaskService, route: string): string {
  return service.submit({
    domain: 'flood-areas',
    route,
    priority: 'normal',
    params: {},
  }).taskId
}

describe('TaskService.expireStalePending（接线后的真实语义）', () => {
  it('🔴 等太久的 pending 判 failed，并清掉队列位次', async () => {
    const service = makeService()
    submitOn(service, '/a-analysis') // 占住唯一的并发槽
    const queued = submitOn(service, '/b-analysis') // 只能排队 → 停在 pending
    await Promise.resolve()

    expect(service.stats().pending).toBe(1)

    // 注入未来时刻，不依赖墙钟（避免退化成 task.e2e-spec 那类计时 flake）
    const expired = service.expireStalePending(Date.now() + TASK_MAX_WAIT_MS + 1)

    expect(expired).toBe(1)
    const view = service.get(queued)
    expect(view.status).toBe('failed')
    expect(view.error?.message).toContain('排队超时')
    expect(view.queuePosition).toBeUndefined()
    expect(view.finishedAt).toBeDefined() // 终态必须带结束时间，前端进度环据此停动画
    expect(service.stats().pending).toBe(0)
  })

  it('未到等待上限的 pending 不得被误杀', async () => {
    const service = makeService()
    submitOn(service, '/a-analysis')
    const queued = submitOn(service, '/b-analysis')
    await Promise.resolve()

    expect(service.expireStalePending(Date.now() + 1_000)).toBe(0)
    expect(service.get(queued).status).toBe('pending')
  })

  it('已终态的任务不受超时判定影响（幂等）', async () => {
    const service = makeService()
    submitOn(service, '/a-analysis')
    const queued = submitOn(service, '/b-analysis')
    await Promise.resolve()

    service.cancel(queued) // 用户主动取消 → 已是终态
    const first = service.expireStalePending(Date.now() + TASK_MAX_WAIT_MS + 1)
    const second = service.expireStalePending(Date.now() + TASK_MAX_WAIT_MS + 1)

    expect(first).toBe(0)
    expect(second).toBe(0)
    expect(service.get(queued).status).toBe('cancelled')
  })
})

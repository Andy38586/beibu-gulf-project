import { describe, expect, it } from 'vitest'

import { BusinessError, ErrorCode } from '../src/common/errors/business-error'
import { TaskHandlers } from '../src/modules/task/services/task-handlers'
import { TaskService } from '../src/modules/task/services/task.service'

// 失败任务的下发 message 不得绕过同步路径的生产隐藏策略。
// GET /task/:id 是公开端点，pg/SQL 级底层 message 惯含内网服务名/端口/表名。
// 退避 300/600/1200 ⇒ 终态约在 2.1s 后，等待 2.6s 断言。
const SETTLE_MS = 2600

function makeService(handler: () => Promise<never>): TaskService {
  return new TaskService({
    get: () => handler,
  } as unknown as TaskHandlers)
}

describe('TaskService 失败下发语义', () => {
  it('生产环境：非 BusinessError 的底层 message 被固定文案顶掉', async () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const service = makeService(async () => {
        throw new Error('connect ECONNREFUSED <PG_HOST>:<port>')
      })
      const { taskId } = service.submit({
        domain: 'flood-areas',
        route: '/flood-analysis',
        priority: 'normal',
        params: {},
      })
      await new Promise((r) => setTimeout(r, SETTLE_MS))
      const view = service.get(taskId)
      expect(view.status).toBe('failed')
      expect(view.error?.message).toBe('任务执行失败，请稍后重试')
      expect(view.error?.message).not.toContain('ECONNREFUSED')
      expect(view.error?.bizCode).toBeUndefined()
    } finally {
      process.env.NODE_ENV = prev
    }
  }, 10_000)

  it('生产环境：BusinessError 的业务文案与 bizCode 原样下发', async () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const service = makeService(async () => {
        throw new BusinessError(ErrorCode.INVALID_PARAMS, '缺少或非法的参数：indicator')
      })
      const { taskId } = service.submit({
        domain: 'forecast-timeseries',
        route: '/forecast',
        priority: 'normal',
        params: {},
      })
      await new Promise((r) => setTimeout(r, SETTLE_MS))
      const view = service.get(taskId)
      expect(view.status).toBe('failed')
      expect(view.error?.message).toBe('缺少或非法的参数：indicator')
      expect(view.error?.bizCode).toBe(400001)
    } finally {
      process.env.NODE_ENV = prev
    }
  }, 10_000)

  it('非生产环境：底层 message 原样下发（排障需要）', async () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'
    try {
      const service = makeService(async () => {
        throw new Error('connect ECONNREFUSED <PG_HOST>:<port>')
      })
      const { taskId } = service.submit({
        domain: 'flood-areas',
        route: '/flood-analysis',
        priority: 'normal',
        params: {},
      })
      await new Promise((r) => setTimeout(r, SETTLE_MS))
      const view = service.get(taskId)
      expect(view.error?.message).toContain('ECONNREFUSED')
    } finally {
      process.env.NODE_ENV = prev
    }
  }, 10_000)
})

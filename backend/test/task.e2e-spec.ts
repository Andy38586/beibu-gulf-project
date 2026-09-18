import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module'
import { type TaskHandler, TaskHandlers } from '../src/modules/task/services/task-handlers'
import { TASK_CONCURRENCY } from '../src/modules/task/types/task'

// v4 异步任务域 e2e（S1 验收：V1~V6）。
//
// 设计取舍：**不打真实业务计算**（那会依赖 PostGIS/数据文件，且动辄秒级），
// 而是用 `TaskHandlers.get` 的**可替换性**注入可控 handler ⇒ 队列/重试/串行/插队
// 这些「task 域自己的逻辑」被确定性地测到。业务域能否被正确委托，由
// 各业务域自己的 e2e（flood/route/...）覆盖 —— 职责边界清晰，避免慢测试。
//
// 契约形状（{code,data} 信封）与非 2xx 的 error 体沿用 flood.e2e-spec 的口径。
const ENVELOPE_OK = 200

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  timeoutMs = 5000,
  intervalMs = 20
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await probe()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error('waitFor 超时')
    await settle(intervalMs)
  }
}

describe('v4 异步任务域（/nest-api/task）', () => {
  let app: INestApplication
  let handlers: TaskHandlers
  /** 域 → 被替换成的可控 handler。测试通过 mutate 它来控制执行时长与成败 */
  const stubs = new Map<string, TaskHandler>()
  const realGet = TaskHandlers.prototype.get
  /** 记录 handler 被调用的并发峰值 */
  let inFlight = 0
  let maxInFlight = 0
  /** 记录每个域的调用次数（重试验证用） */
  const callCount = new Map<string, number>()

  beforeAll(async () => {
    // 🔴 必须在 compile 之前替换：Nest 用原型方法完成注入后的调用，替换原型即生效
    TaskHandlers.prototype.get = function (domain: string): TaskHandler {
      const stub = stubs.get(domain)
      if (stub) return stub
      return realGet.call(this, domain as never)
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('nest-api')
    await app.init()
    handlers = app.get(TaskHandlers)
    expect(handlers).toBeTruthy()
  })

  afterAll(async () => {
    await app?.close()
    TaskHandlers.prototype.get = realGet
  })

  beforeEach(() => {
    // 🔴 必须逐测试重置：这些是跨测试共享的模块级变量，不清会让「handler 被调了几次」
    // 这类断言把**上一个测试的调用**算进来（V3 首次跑就踩了这个，误判成「取消没生效」）。
    callCount.clear()
    inFlight = 0
    maxInFlight = 0
    stubs.clear()
  })

  function stub(domain: string, handler: TaskHandler): void {
    stubs.set(domain, handler)
  }

  /** 包装：统计并发与调用次数 */
  function tracked(domain: string, inner: TaskHandler): TaskHandler {
    return async (params) => {
      callCount.set(domain, (callCount.get(domain) ?? 0) + 1)
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      try {
        return await inner(params)
      } finally {
        inFlight--
      }
    }
  }

  const submit = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/nest-api/task').send(body)

  const poll = (taskId: string) => request(app.getHttpServer()).get(`/nest-api/task/${taskId}`)

  it('V1 提交立即返回 taskId，且不等待计算完成', async () => {
    stub(
      'flood-areas',
      tracked('flood-areas', async () => {
        await settle(300)
        return { waterLevel: 2.5, value: 42 }
      })
    )

    const started = Date.now()
    const res = await submit({
      domain: 'flood-areas',
      route: '/flood-analysis',
      priority: 'high',
      params: { waterLevel: 2.5 },
    }).expect(ENVELOPE_OK)
    const elapsed = Date.now() - started

    expect(res.body.code).toBe(200)
    expect(typeof res.body.data.taskId).toBe('string')
    expect(res.body.data.status).toBe('pending')
    // 验收要求「< 100ms」：handler 自己睡 300ms，若提交在等计算必然 >300ms
    expect(elapsed).toBeLessThan(200)

    // 最终能查到结果（V2）
    const done = await waitFor(async () => {
      const r = await poll(res.body.data.taskId)
      return r.body.data.status === 'done' ? r.body.data : undefined
    })
    expect(done.result).toEqual({ waterLevel: 2.5, value: 42 })
    expect(done.progress).toBe(1)
    expect(typeof done.startedAt).toBe('number')
    expect(typeof done.finishedAt).toBe('number')
  })

  it('V2 查询返回完整视图字段（queuePosition/retryCount/时间戳）', async () => {
    stub('flood-areas', async () => ({ ok: true }))
    const res = await submit({
      domain: 'flood-areas',
      route: '/flood-analysis',
      params: {},
    }).expect(200)

    // 提交响应：pending 阶段必须带 queuePosition（前端据此显示「排队第 N 位」）
    expect(res.body.data.queuePosition).toBe(1)
    expect(res.body.data.status).toBe('pending')

    // ⚠️ 不「等 running 再断言」：handler 可能在两次轮询之间就跑完并越过 running
    //（瞬间返回的 stub 实测如此）⇒ 抓中间态会超时。中间态由 V1 的 progress/V4 的
    // 队列位次覆盖，这里只验终态的字段契约。
    const view = await waitFor(async () => {
      const r = await poll(res.body.data.taskId)
      return r.body.data.status === 'done' ? r.body.data : undefined
    })

    // ⚠️ 不断言「键的完整集合」：JSON 序列化会丢掉值为 undefined 的字段
    //（error/queuePosition 在成功终态就是 undefined）——断言重点字段存在与类型即可
    expect(view.taskId).toBe(res.body.data.taskId)
    expect(view.domain).toBe('flood-areas')
    expect(view.route).toBe('/flood-analysis')
    expect(view.status).toBe('done')
    expect(view.progress).toBe(1)
    expect(view.retryCount).toBe(0)
    expect(view.result).toEqual({ ok: true })
    expect(typeof view.createdAt).toBe('number')
    expect(typeof view.startedAt).toBe('number')
    expect(typeof view.finishedAt).toBe('number')
    // 终态不再占用队列 ⇒ 前端应停止轮询排队位次
    expect(view.queuePosition).toBeUndefined()
  })

  it('V3 取消：排队中的任务可被真正取消（出队，不执行）', async () => {
    // 第一个任务用可控的「闸门」阻塞，确保第二个任务一定停在队列里
    let releaseBlocker: () => void = () => {}
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve
    })
    stub(
      'route-path',
      tracked('route-path', async () => {
        await blocker
        return { first: true }
      })
    )
    stub(
      'flood-areas',
      tracked('flood-areas', async () => ({ second: true }))
    )

    const first = await submit({
      domain: 'route-path',
      route: '/route-analysis',
      params: {},
    }).expect(200)

    // 等第一个任务真的进入 running，再提交第二个（否则第二个可能抢到执行位）
    await waitFor(async () => {
      const r = await poll(first.body.data.taskId)
      return r.body.data.status === 'running' ? true : undefined
    })

    const second = await submit({
      domain: 'flood-areas',
      route: '/flood-analysis',
      params: {},
    }).expect(200)

    // 第二个必然在排队（串行：第一个占着执行位）
    const queued = await poll(second.body.data.taskId)
    expect(queued.body.data.status).toBe('pending')
    expect(queued.body.data.queuePosition).toBe(1)

    const cancelled = await request(app.getHttpServer())
      .delete(`/nest-api/task/${second.body.data.taskId}`)
      .expect(200)
    expect(cancelled.body.data.status).toBe('cancelled')

    releaseBlocker()
    await settle(150)
    // 关键断言：被取消的任务的 handler **从未被调用**
    expect(callCount.get('flood-areas') ?? 0).toBe(0)

    const firstDone = await waitFor(async () => {
      const r = await poll(first.body.data.taskId)
      return r.body.data.status === 'done' ? r.body.data : undefined
    })
    expect(firstDone.result).toEqual({ first: true })
  })

  it('V4 串行队列：三任务同时提交，并发峰值恒为 1', async () => {
    maxInFlight = 0
    stub(
      'route-path',
      tracked('route-path', async () => {
        await settle(120)
        return { route: true }
      })
    )
    stub(
      'flood-areas',
      tracked('flood-areas', async () => {
        await settle(120)
        return { flood: true }
      })
    )
    stub(
      'forecast-timeseries',
      tracked('forecast-timeseries', async () => {
        await settle(120)
        return { forecast: true }
      })
    )

    // 🔴 三个任务必须落在**三个不同路由**上：同路由会被「一个路由一个任务」规则
    // 互相取消，后面那个永远到不了终态（V4 首版就踩了，表现为测试超时）。
    const submissions: Array<[string, string]> = [
      ['route-path', '/route-analysis'],
      ['flood-areas', '/flood-analysis'],
      ['forecast-timeseries', '/forecast'],
    ]
    const ids: string[] = []
    for (const [domain, route] of submissions) {
      const r = await submit({ domain, route, params: {} }).expect(200)
      ids.push(r.body.data.taskId)
    }

    // 至少一个任务应处于排队态（证明没有并行跑）
    const positions = await Promise.all(
      ids.map(
        async (id) => (await poll(id)).body.data as { status: string; queuePosition?: number }
      )
    )
    expect(positions.some((v) => v.status === 'pending')).toBe(true)

    await waitFor(async () => {
      const views = await Promise.all(
        ids.map(async (id) => (await poll(id)).body.data as { status: string })
      )
      return views.every((v) => v.status === 'done') ? true : undefined
    }, 8000)

    expect(TASK_CONCURRENCY).toBe(1)
    expect(maxInFlight).toBe(1)
  }, 15000)

  it('V5 优先级插队：high 排在已入队的 normal 之前', async () => {
    // 用一个长任务占住执行位，让后面的任务都停在队列里
    stub(
      'route-path',
      tracked('route-path', async () => {
        await settle(400)
        return { leader: true }
      })
    )
    stub(
      'flood-areas',
      tracked('flood-areas', async () => ({ normal: true }))
    )
    stub(
      'forecast-timeseries',
      tracked('forecast-timeseries', async () => ({ high: true }))
    )

    const leader = await submit({ domain: 'route-path', route: '/route-analysis', params: {} })
    expect(leader.body.data.taskId).toBeTruthy()
    await settle(30) // 让 leader 进入 running

    const normal = await submit({
      domain: 'flood-areas',
      route: '/flood-analysis',
      priority: 'normal',
      params: {},
    }).expect(200)
    const high = await submit({
      domain: 'forecast-timeseries',
      route: '/forecast',
      priority: 'high',
      params: {},
    }).expect(200)

    // normal 先入队（位次 1），high 后入队但应插到它前面（位次 1，normal 变 2）
    expect(high.body.data.queuePosition).toBe(1)
    const normalView = await poll(normal.body.data.taskId)
    expect(normalView.body.data.queuePosition).toBe(2)
  })

  it('V6 自动重试：连续失败 3 次后判 failed（handler 共被调用 4 次）', async () => {
    let calls = 0
    stub('site-analysis', async () => {
      calls++
      throw new Error('模拟下游故障')
    })

    const res = await submit({
      domain: 'site-analysis',
      route: '/site-selection',
      params: {},
    }).expect(200)

    const failed = await waitFor(async () => {
      const r = await poll(res.body.data.taskId)
      return r.body.data.status === 'failed' ? r.body.data : undefined
    }, 8000)

    expect(failed.error.message).toContain('模拟下游故障')
    expect(failed.retryCount).toBe(3)
    // 首次 + 3 次重试 = 4 次
    expect(calls).toBe(4)
    // 退避合计 300+600+1200 = 2100ms，测试默认 5s 太紧（vitest 默认 5000ms）
  }, 15000)

  it('V6b 重试后成功：中途失败一次，最终 status=done 且 retryCount=1', async () => {
    let calls = 0
    stub('flood-areas', async () => {
      calls++
      if (calls === 1) throw new Error('首次抖动')
      return { recovered: true }
    })

    const res = await submit({
      domain: 'flood-areas',
      route: '/flood-analysis',
      params: {},
    }).expect(200)

    const done = await waitFor(async () => {
      const r = await poll(res.body.data.taskId)
      return r.body.data.status === 'done' ? r.body.data : undefined
    }, 8000)
    expect(done.result).toEqual({ recovered: true })
    expect(done.retryCount).toBe(1)
  })

  it('V14 同路由再提交：旧任务被 cancelled（一个路由只有一个任务）', async () => {
    stub(
      'route-path',
      tracked('route-path', async () => {
        await settle(250)
        return { slow: true }
      })
    )

    const oldTask = await submit({
      domain: 'route-path',
      route: '/route-analysis',
      params: {},
    }).expect(200)
    await settle(30)

    const newTask = await submit({
      domain: 'route-path',
      route: '/route-analysis',
      params: {},
    }).expect(200)

    const oldView = await poll(oldTask.body.data.taskId)
    expect(oldView.body.data.status).toBe('cancelled')

    // 不同路由的任务**不受影响**（分槽）
    stub('flood-areas', async () => ({ other: true }))
    const other = await submit({
      domain: 'flood-areas',
      route: '/flood-analysis',
      params: {},
    }).expect(200)
    const otherDone = await waitFor(async () => {
      const r = await poll(other.body.data.taskId)
      return r.body.data.status === 'done' ? r.body.data : undefined
    })
    expect(otherDone.result).toEqual({ other: true })
    expect(newTask.body.data.taskId).not.toBe(oldTask.body.data.taskId)
  })

  it('参数校验：非法 domain / 缺 route / 非法 priority 均 400', async () => {
    await submit({ domain: 'not-a-domain', route: '/x' }).expect(400)
    await submit({ domain: 'flood-areas' }).expect(400)
    await submit({ domain: 'flood-areas', route: '/x', priority: 'urgent' }).expect(400)
    await submit({ domain: 'flood-areas', route: '/x', params: [] }).expect(400)
  })

  it('查询不存在的任务 → 404 业务码 404001', async () => {
    const res = await poll('t-not-exist').expect(404)
    expect(res.body.code).toBe(404001)
    expect(res.body.data).toBeNull()
  })

  it('取消不存在的任务 → 404；取消已终态任务 → 幂等返回当前状态', async () => {
    await request(app.getHttpServer()).delete('/nest-api/task/t-not-exist').expect(404)

    stub('flood-areas', async () => ({ quick: true }))
    const res = await submit({
      domain: 'flood-areas',
      route: '/flood-analysis',
      params: {},
    }).expect(200)
    await waitFor(async () => {
      const r = await poll(res.body.data.taskId)
      return r.body.data.status === 'done' ? true : undefined
    })
    const again = await request(app.getHttpServer())
      .delete(`/nest-api/task/${res.body.data.taskId}`)
      .expect(200)
    expect(again.body.data.status).toBe('done')
  })
})

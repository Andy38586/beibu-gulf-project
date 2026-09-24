import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module'
import { generateToken } from '../src/common/utils/jwt.util'
import { type TaskHandler, TaskHandlers } from '../src/modules/task/services/task-handlers'
import { TaskService } from '../src/modules/task/services/task.service'
import { TASK_CONCURRENCY, TASK_RETRY_BACKOFF_MS } from '../src/modules/task/types/task'
import { TASK_CLIENT_HEADER } from '../src/modules/task/utils/request-owner'

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
  /** d059 用例临时设置 JWT_SECRET，afterAll 还原（不污染同进程的其它测试文件） */
  let savedJwtSecret: string | undefined

  beforeAll(async () => {
    // d059 属主用例要签真令牌：JWT_SECRET 与 auth.e2e-spec 同口径（本文件的 handler 全打桩，不连库）
    savedJwtSecret = process.env.JWT_SECRET
    process.env.JWT_SECRET = 'x'.repeat(64)

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
    if (savedJwtSecret === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = savedJwtSecret
  })

  /**
   * 等队列排空 —— 用例间隔离。
   *
   * 为什么必须有：`registry` / `queue` 是 `TaskService` 单例（Nest provider）里的**跨用例共享**
   * 状态，而 `beforeEach` 原先只清 `callCount/inFlight/stubs`。V1/V4 的 handler 睡 1500ms
   * （`89c0b4ab` 为治 V1 墙钟脆断从 300ms 抬上来的），用例收尾却只 `settle(150)` ⇒ 在飞任务
   * 会拖进下一个用例的执行窗口。V6（自动重试：4 次调用 + 300/600/1200ms 退避）因此**整文件跑
   * 稳定超时、单跑必绿** —— 这是用例间耦合，不是 flaky；靠"把等待调大"治只会掩盖它。
   */
  async function drainQueue(): Promise<void> {
    const service = app.get(TaskService)
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const s = service.stats()
      if (s.active === 0 && s.pending === 0) return
      await settle(20)
    }
    // fail-loud：排不空说明有用例留下了在飞任务（或忘了 release 闸门），必须当场暴露
    throw new Error(`队列未在预算内排空：${JSON.stringify(app.get(TaskService).stats())}`)
  }

  beforeEach(async () => {
    // 顺序要紧：**先排空再清状态**。反过来的话，在飞任务会落回真实 handler（stub 已清），
    // 变得又慢又不可控——那正是"看起来像 flake"的来源。
    await drainQueue()
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
    // handler 睡 HANDLER_MS：只要提交不阻塞，返回耗时必然远小于它。
    // 阈值取「睡眠时长的一半」而不是写死 200ms——本用例曾被全量跑（多 worker 抢 CPU）
    // 拖到 240ms 而红，属墙钟脆断：真正要钉的是「不等计算完成」，不是某台机器的手速。
    const HANDLER_MS = 1500
    stub(
      'flood-areas',
      tracked('flood-areas', async () => {
        await settle(HANDLER_MS)
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
    // 若提交在等计算，耗时 ≥ HANDLER_MS（1500ms）；取一半为界，给全量并发留足余量
    expect(elapsed).toBeLessThan(HANDLER_MS / 2)

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

    // 预算按退避真值推导（TASK_RETRY_BACKOFF_MS 合计 2100ms），不写死 8000——
    // 写死的"够大就行"会掩盖用例间耦合（V6 曾因此在整文件跑时稳定超时）。
    const retryBudgetMs = TASK_RETRY_BACKOFF_MS.reduce((sum, ms) => sum + ms, 0)
    const failed = await waitFor(async () => {
      const r = await poll(res.body.data.taskId)
      return r.body.data.status === 'failed' ? r.body.data : undefined
    }, retryBudgetMs + 4000)

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

  it('d059 属主：B 的令牌取消 A 的任务必失败（404），同路由提交不取代，匿名也读不到', async () => {
    const tokenA = generateToken({ id: 'u-a', username: 'A' })
    const tokenB = generateToken({ id: 'u-b', username: 'B' })
    let releaseBlocker: () => void = () => {}
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve
    })
    stub(
      'route-path',
      tracked('route-path', async () => {
        await blocker
        return { mine: true }
      })
    )

    const asA = await request(app.getHttpServer())
      .post('/nest-api/task')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ domain: 'route-path', route: '/route-analysis', params: {} })
      .expect(200)
    const taskA = asA.body.data.taskId

    // B 提交同一路由：现形态（取代键只有 route）会把 A 的任务取消 ⇒ 红
    const asB = await request(app.getHttpServer())
      .post('/nest-api/task')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ domain: 'route-path', route: '/route-analysis', params: {} })
      .expect(200)
    expect(asB.body.data.taskId).not.toBe(taskA)

    const aView = await request(app.getHttpServer())
      .get(`/nest-api/task/${taskA}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200)
    expect(aView.body.data.status).not.toBe('cancelled')

    // B 取消/查询 A 的任务：按 404 处理（与「不存在」同码，不暴露存在性）
    await request(app.getHttpServer())
      .delete(`/nest-api/task/${taskA}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404)
    await request(app.getHttpServer())
      .get(`/nest-api/task/${taskA}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404)
    // 匿名（无令牌）同样拿不到别人属主的结果
    await request(app.getHttpServer()).get(`/nest-api/task/${taskA}`).expect(404)

    // 属主本人可取消（失败的是越权，不是功能）
    const cancelled = await request(app.getHttpServer())
      .delete(`/nest-api/task/${taskA}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200)
    expect(cancelled.body.data.status).toBe('cancelled')

    releaseBlocker()
    await settle(150)
  })

  // R2（返工清单 §五-4）补的就是这一条：此前只有**服务层**用例（`task-ownership-capacity.spec.ts`
  // 直调 `service.cancel(taskId, ownerB)`，owner 是手工拼的字符串）与**解析层**用例
  // （`resolveRequestOwner`），两半各测一半——「请求带不同会话头 ⇒ 属主不同 ⇒ 取消 404」这条
  // 整链没有任何承接体。本文件上面那条 A/B 用例走的是 Bearer 登录用户，匿名会话
  // （`x-task-client`）这一路在 HTTP 层是空的。
  it('d059/R2 匿名会话隔离：两个不同匿名会话互相取消/查询必 404（与「不存在」同码同文案）', async () => {
    let releaseBlocker: () => void = () => {}
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve
    })
    stub(
      'route-path',
      tracked('route-path', async () => {
        await blocker
        return { mine: true }
      })
    )
    // 合法会话 id：16–64 位 URL 安全串（CLIENT_ID_RE），与前端每标签页生成的口径一致
    const CLIENT_A = 'a'.repeat(32)
    const CLIENT_B = 'b'.repeat(32)

    // A 匿名提交（会话 A）
    const asA = await request(app.getHttpServer())
      .post('/nest-api/task')
      .set(TASK_CLIENT_HEADER, CLIENT_A)
      .send({ domain: 'route-path', route: '/route-analysis', params: {} })
      .expect(ENVELOPE_OK)
    const taskA = asA.body.data.taskId

    // B 匿名提交同路由：不得取代 A 的任务（共用一个匿名槽时此处 A 已被 cancelled ⇒ 红）
    const asB = await request(app.getHttpServer())
      .post('/nest-api/task')
      .set(TASK_CLIENT_HEADER, CLIENT_B)
      .send({ domain: 'route-path', route: '/route-analysis', params: {} })
      .expect(ENVELOPE_OK)
    expect(asB.body.data.taskId).not.toBe(taskA)
    const aView = await request(app.getHttpServer())
      .get(`/nest-api/task/${taskA}`)
      .set(TASK_CLIENT_HEADER, CLIENT_A)
      .expect(200)
    expect(aView.body.data.status).not.toBe('cancelled')

    // B 取消 A 的任务 ⇒ 404，且与「取消不存在的任务」同码同文案（不暴露存在性）
    const cancelByB = await request(app.getHttpServer())
      .delete(`/nest-api/task/${taskA}`)
      .set(TASK_CLIENT_HEADER, CLIENT_B)
      .expect(404)
    const missing = await request(app.getHttpServer())
      .delete('/nest-api/task/t-not-exist')
      .set(TASK_CLIENT_HEADER, CLIENT_B)
      .expect(404)
    expect(cancelByB.body.code).toBe(missing.body.code)
    expect(cancelByB.body.message).toBe(missing.body.message)

    await request(app.getHttpServer())
      .get(`/nest-api/task/${taskA}`)
      .set(TASK_CLIENT_HEADER, CLIENT_B)
      .expect(404)

    // 同会话 A 仍可取消（失败的是越权，不是功能本身——防"恒 404"也能过）
    const cancelled = await request(app.getHttpServer())
      .delete(`/nest-api/task/${taskA}`)
      .set(TASK_CLIENT_HEADER, CLIENT_A)
      .expect(200)
    expect(cancelled.body.data.status).toBe('cancelled')

    releaseBlocker()
    await settle(150)
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

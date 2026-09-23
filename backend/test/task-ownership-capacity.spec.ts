import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BusinessError, ErrorCode } from '../src/common/errors/business-error'
import { generateToken } from '../src/common/utils/jwt.util'
import { parseSiteAnalysisBody } from '../src/modules/site-analysis/dto/site-analysis-request'
import { TaskHandlers } from '../src/modules/task/services/task-handlers'
import { TaskRegistry } from '../src/modules/task/services/task-registry'
import { TaskService } from '../src/modules/task/services/task.service'
import {
  ANONYMOUS_OWNER,
  TASK_REGISTRY_MAX_RECORDS,
  TASK_TERMINAL_MIN_RETAIN_MS,
  type TaskRecord,
} from '../src/modules/task/types/task'
import {
  ANONYMOUS_OWNER_PREFIX,
  resolveRequestOwner,
  TASK_CLIENT_HEADER,
} from '../src/modules/task/utils/request-owner'

// d059 / d060 / d061 的判据回归（922-R4 §1.3 三条最小判据，逐条对应）：
//   d059 取代键与取消/查询都必须带属主——只按 route 判定时任何人提交同一 route
//        即可取消他人任务（不需知 taskId，补 @UseGuards 也不解）；
//   d060 容量只有「活跃数」一维，终态记录在 TTL 窗内不计条数也不计字节
//        （单条结果可达数十 MB ⇒ 进程内无界增长）；
//   d061 任务通道 `as never` 直灌 + service 的 `return {error}` 被 onSuccess 记成 done，
//        与同步通道的 422 分叉。
const OWNER_A = 'user-a'
const OWNER_B = 'user-b'

const FAST_HANDLER = async () => ({ ok: true })

function makeService(
  handler: (params: Record<string, unknown>) => Promise<unknown> = FAST_HANDLER
): TaskService {
  return new TaskService({ get: () => handler } as unknown as TaskHandlers)
}

/** 闸门：让任务停在 running，便于在此状态下做取代/取消断言（用完必须 release） */
function makeGate(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => {}
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

/**
 * 纯微任务推进（不用 setTimeout/setImmediate）：d060 的用例在 fake timers 下跑，
 * 任何被伪造的定时器都会让等待悬空。
 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

async function settleUntilDone(
  service: TaskService,
  taskId: string,
  ownerId: string
): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (service.get(taskId, ownerId).status === 'done') return
    await Promise.resolve()
  }
  throw new Error(`${taskId} 未在微任务预算内进入 done`)
}

function submit(
  service: TaskService,
  input: { route: string; ownerId?: string; domain?: 'flood-areas' | 'site-analysis' }
) {
  return service.submit({
    domain: input.domain ?? 'flood-areas',
    route: input.route,
    ownerId: input.ownerId ?? OWNER_A,
    priority: 'normal',
    params: {},
  })
}

/** 取同步抛出的错误对象（用于断言 bizCode；vitest 的 toThrow 不便携带业务码） */
function catchSync(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  throw new Error('期望抛错，但调用正常返回')
}

describe('d059 任务属主维度', () => {
  it('🔴 取代键含属主：B 提交同路由不得取消 A 的任务', async () => {
    const gate = makeGate()
    const service = makeService(async () => {
      await gate.promise
      return { ok: true }
    })

    const taskA = submit(service, { route: '/flood-analysis', ownerId: OWNER_A })
    await flushMicrotasks()

    const taskB = submit(service, { route: '/flood-analysis', ownerId: OWNER_B })

    // 现形态（只按 route 判定）此处 A 已被 cancelled ⇒ 红
    expect(service.get(taskA.taskId, OWNER_A).status).toBe('running')
    expect(taskB.taskId).not.toBe(taskA.taskId)

    gate.release()
  })

  it('同属主同路由仍然取代（不变式 I8 未被属主维度破坏）', async () => {
    const gate = makeGate()
    const service = makeService(async () => {
      await gate.promise
      return { ok: true }
    })

    const first = submit(service, { route: '/route-analysis', ownerId: OWNER_A })
    await flushMicrotasks()
    submit(service, { route: '/route-analysis', ownerId: OWNER_A })

    expect(service.get(first.taskId, OWNER_A).status).toBe('cancelled')
    gate.release()
  })

  it('🔴 非属主取消/查询必失败，且与"不存在"同码（不暴露存在性）', async () => {
    const gate = makeGate()
    const service = makeService(async () => {
      await gate.promise
      return { ok: true }
    })
    const taskA = submit(service, { route: '/flood-analysis', ownerId: OWNER_A })
    await flushMicrotasks()

    const cancelErr = catchSync(() => service.cancel(taskA.taskId, OWNER_B)) as BusinessError
    expect(cancelErr.bizCode).toBe(ErrorCode.NOT_FOUND.code)
    const getErr = catchSync(() => service.get(taskA.taskId, OWNER_B)) as BusinessError
    expect(getErr.bizCode).toBe(ErrorCode.NOT_FOUND.code)
    // 属主本人两条都正常（失败的是越权而不是功能本身）
    expect(service.get(taskA.taskId, OWNER_A).status).toBe('running')
    expect(service.cancel(taskA.taskId, OWNER_A).status).toBe('cancelled')

    gate.release()
  })
})

describe('resolveRequestOwner（请求 → 属主）', () => {
  let savedSecret: string | undefined
  beforeEach(() => {
    savedSecret = process.env.JWT_SECRET
    process.env.JWT_SECRET = 'x'.repeat(64)
  })
  afterEach(() => {
    if (savedSecret === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = savedSecret
  })

  const req = (init: { cookie?: string; authorization?: string; client?: string }) =>
    ({
      cookies: init.cookie ? { auth_token: init.cookie } : undefined,
      headers: {
        ...(init.authorization ? { authorization: init.authorization } : {}),
        ...(init.client ? { [TASK_CLIENT_HEADER]: init.client } : {}),
      },
    }) as never

  it('无令牌 ⇒ 匿名属主（公开端点语义不变）', () => {
    expect(resolveRequestOwner(req({}))).toBe(ANONYMOUS_OWNER)
  })

  it('🔴 无令牌但带合法会话头 ⇒ 匿名按会话分槽（同一路由下匿名不再互相取代/取消）', () => {
    const idA = 'a'.repeat(32)
    const idB = 'b'.repeat(32)
    expect(resolveRequestOwner(req({ client: idA }))).toBe(`${ANONYMOUS_OWNER_PREFIX}${idA}`)
    expect(resolveRequestOwner(req({ client: idA }))).not.toBe(
      resolveRequestOwner(req({ client: idB }))
    )
    // 同一会话头的两次请求必须同槽（提交后能取消/查询自己刚提交的任务）
    expect(resolveRequestOwner(req({ client: idA }))).toBe(
      resolveRequestOwner(req({ client: idA }))
    )
    // 登录用户仍按用户 id，不被会话头顶掉
    const tokenA = generateToken({ id: 'u-a', username: 'A' })
    expect(resolveRequestOwner(req({ authorization: `Bearer ${tokenA}`, client: idB }))).toBe('u-a')
  })

  it('🔴 畸形/过短会话 id 不采信，退回共享匿名槽（防穷举与畸形属主）', () => {
    for (const bad of ['short', 'x'.repeat(65), 'has space and !', '中文会话']) {
      expect(resolveRequestOwner(req({ client: bad }))).toBe(ANONYMOUS_OWNER)
    }
  })

  it('🔴 两个匿名会话之间不可互相取代/取消（服务层同判据：属主不等即 404）', async () => {
    const ownerA = `${ANONYMOUS_OWNER_PREFIX}${'a'.repeat(32)}`
    const ownerB = `${ANONYMOUS_OWNER_PREFIX}${'b'.repeat(32)}`
    const gate = makeGate()
    const service = makeService(async () => {
      await gate.promise
      return { ok: true }
    })
    const taskA = submit(service, { route: '/flood-analysis', ownerId: ownerA })
    await flushMicrotasks()
    // 同路由、不同匿名会话：不得互相取代（原形态两人共用一个槽，后提交者把前者取消）
    const taskB = submit(service, { route: '/flood-analysis', ownerId: ownerB })
    await flushMicrotasks()
    expect(taskB.taskId).not.toBe(taskA.taskId)
    expect(service.get(taskA.taskId, ownerA).status).toBe('running')

    const cancelErr = catchSync(() => service.cancel(taskA.taskId, ownerB)) as BusinessError
    expect(cancelErr.bizCode).toBe(ErrorCode.NOT_FOUND.code)
    const getErr = catchSync(() => service.get(taskA.taskId, ownerB)) as BusinessError
    expect(getErr.bizCode).toBe(ErrorCode.NOT_FOUND.code)
    // 会话本人两条都正常
    expect(service.cancel(taskA.taskId, ownerA).status).toBe('cancelled')

    gate.release()
  })

  it('Bearer 有效令牌 ⇒ JWT 里的用户 id；cookie 优先于 Bearer', () => {
    const tokenA = generateToken({ id: 'u-a', username: 'A' })
    const tokenB = generateToken({ id: 'u-b', username: 'B' })
    expect(resolveRequestOwner(req({ authorization: `Bearer ${tokenA}` }))).toBe('u-a')
    expect(resolveRequestOwner(req({ cookie: tokenB, authorization: `Bearer ${tokenA}` }))).toBe(
      'u-b'
    )
  })

  it('🔴 伪造/畸形令牌 ⇒ 匿名（不冒充他人属主）', () => {
    expect(resolveRequestOwner(req({ authorization: 'Bearer not-a-jwt' }))).toBe(ANONYMOUS_OWNER)
    expect(resolveRequestOwner(req({ cookie: 'a.b.c' }))).toBe(ANONYMOUS_OWNER)
  })
})

describe('d060 注册表容量三重维度', () => {
  function record(taskId: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
    return {
      taskId,
      domain: 'flood-areas',
      route: '/flood-analysis',
      ownerId: ANONYMOUS_OWNER,
      priority: 'normal',
      params: {},
      status: 'pending',
      progress: 0,
      retryCount: 0,
      createdAt: Date.now(),
      ...overrides,
    }
  }

  it('结果字节记账：写入计账、覆盖先扣旧值、删除清账', () => {
    const registry = new TaskRegistry({ maxRecords: 99, maxBytes: 1_000_000, minRetainMs: 0 })
    registry.add(record('t1'))
    expect(registry.totalBytes).toBe(0)

    registry.patch('t1', { status: 'done', result: { s: 'x'.repeat(100) } })
    expect(registry.totalBytes).toBeGreaterThanOrEqual(200) // 100 字符 × UTF-16 双字节

    const withBig = registry.totalBytes
    registry.patch('t1', { result: { s: 'y' } })
    expect(registry.totalBytes).toBeLessThan(withBig)

    registry.sweep(Date.now() + 31 * 60 * 1000)
    expect(registry.totalBytes).toBe(0)
    expect(registry.size).toBe(0)
  })

  it('条数维度：预留即将入表的这一条（上限不被顶破）', () => {
    const registry = new TaskRegistry({ maxRecords: 2, maxBytes: 1_000_000, minRetainMs: 0 })
    registry.add(record('t1', { status: 'done' }))
    registry.add(record('t2', { status: 'done' }))
    expect(registry.capacityProblem()).toMatch(/记录数已达上限/)
    // 过了保留窗 ⇒ 淘汰最旧，容量回到「还能再收一条」
    expect(registry.trimTerminal(Date.now())).toBe(1)
    expect(registry.capacityProblem()).toBeUndefined()
  })

  it('字节维度：超限先淘汰最旧终态；仍在最小保留窗内则报超限', () => {
    const registry = new TaskRegistry({ maxRecords: 99, maxBytes: 100, minRetainMs: 1000 })
    const now = Date.now()

    registry.add(record('old', { status: 'done', createdAt: now - 5000 }))
    registry.patch('old', { result: 'x'.repeat(100) }) // 200 字节 > 100
    expect(registry.capacityProblem()).toMatch(/内存已达上限/)

    // 保留窗内：不可淘汰（用户可能正在轮询取结果）⇒ 仍是超限
    expect(registry.trimTerminal(now)).toBe(0)
    expect(registry.capacityProblem()).toBeDefined()

    // 过窗：淘汰最旧终态 ⇒ 不再超限
    expect(registry.trimTerminal(now + 1000)).toBe(1)
    expect(registry.capacityProblem()).toBeUndefined()
    expect(registry.totalBytes).toBe(0)
  })

  it('🔴 服务侧接线：灌满终态记录 ⇒ 新提交被拒；过保留窗 ⇒ 淘汰后放行', async () => {
    vi.useFakeTimers()
    try {
      const service = makeService()
      for (let i = 0; i < TASK_REGISTRY_MAX_RECORDS; i++) {
        const { taskId } = submit(service, { route: `/route-${i}` })
        await settleUntilDone(service, taskId, OWNER_A)
      }
      expect(service.stats().total).toBe(TASK_REGISTRY_MAX_RECORDS)

      // 现形态（无条数/字节维度）此处会新增一条 ⇒ 红
      const overflow = catchSync(() => submit(service, { route: '/overflow' })) as BusinessError
      expect(overflow.bizCode).toBe(ErrorCode.ANALYSIS_FAILED.code)
      expect(overflow.message).toMatch(/记录数已达上限/)

      // 推过最小保留窗：淘汰最旧终态后容量恢复，且上限不被顶破
      vi.advanceTimersByTime(TASK_TERMINAL_MIN_RETAIN_MS + 1000)
      const { taskId } = submit(service, { route: '/after-gc' })
      await settleUntilDone(service, taskId, OWNER_A)
      expect(service.stats().total).toBe(TASK_REGISTRY_MAX_RECORDS)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('d061 任务通道与同步通道同校验同终态', () => {
  function buildHandlers() {
    const siteAnalysisService = { analyze: vi.fn().mockResolvedValue({ score: 1 }) }
    const handlers = new TaskHandlers(
      {} as never,
      {} as never,
      siteAnalysisService as never,
      {} as never
    )
    return { handlers, siteAnalysisService }
  }

  it('🔴 非法入参：任务通道与同步通道同码（400001），且不进入业务 service', async () => {
    const { handlers, siteAnalysisService } = buildHandlers()
    const bad = { selectedKeys: ['hospital'], typeSettings: { hospital: { importance: 999 } } }

    const httpCode = (catchSync(() => parseSiteAnalysisBody(bad)) as BusinessError).bizCode
    const taskErr = (await handlers
      .get('site-analysis')(bad)
      .then(() => undefined)
      .catch((e: unknown) => e)) as BusinessError

    expect(taskErr).toBeInstanceOf(BusinessError)
    expect(taskErr.bizCode).toBe(httpCode) // 现形态：as never 直灌 ⇒ 不抛错、直接调 service ⇒ 红
    expect(siteAnalysisService.analyze).not.toHaveBeenCalled()
  })

  it('🔴 业务失败（service resolve {error}）⇒ 抛 422001，不被队列记成 done', async () => {
    const { handlers, siteAnalysisService } = buildHandlers()
    siteAnalysisService.analyze.mockResolvedValue({ error: '缺少必要参数: selectedKeys, typeSettings' })

    const err = (await handlers
      .get('site-analysis')({ selectedKeys: ['hospital'], typeSettings: {} })
      .then(() => undefined)
      .catch((e: unknown) => e)) as BusinessError

    expect(err).toBeInstanceOf(BusinessError)
    expect(err.bizCode).toBe(ErrorCode.ANALYSIS_FAILED.code)
    expect(err.message).toContain('缺少必要参数')
  })

  it('合法入参：仍原样委托 analyze（口径不变）', async () => {
    const { handlers, siteAnalysisService } = buildHandlers()
    const params = {
      selectedKeys: ['port'],
      typeSettings: { port: { importance: 5, radius: 2000 } },
      weights: { distance: 3 },
      city: 'beihai',
    }
    await handlers.get('site-analysis')(params)
    expect(siteAnalysisService.analyze).toHaveBeenCalledWith(params)
  })
})

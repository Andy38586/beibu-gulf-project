import { describe, expect, it, vi } from 'vitest'

import {
  type TaskJob,
  TaskQueue,
  type TaskQueueHooks,
} from '../src/modules/task/services/task-queue'
import { TaskRegistry } from '../src/modules/task/services/task-registry'
import { TASK_RETRY_BACKOFF_MS, type TaskRecord } from '../src/modules/task/types/task'

// S1 队列与注册表的**纯单测**（不起 Nest、不联网）。
// 覆盖 e2e 里构造困难的边界：位次计算、出队、TTL 清扫、重试次数上限、取消检查点。

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function makeRegistry(): TaskRegistry {
  return new TaskRegistry()
}

function record(taskId: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    taskId,
    domain: 'flood-areas',
    route: '/flood-analysis',
    priority: 'normal',
    params: {},
    status: 'pending',
    progress: 0,
    retryCount: 0,
    createdAt: Date.now(),
    ...overrides,
  }
}

/** 记录队列回调的调用（类型收窄到实际存的形状，避免 `unknown[]` 取值时的 TS18046） */
interface RecordedCalls {
  start: string[]
  progress: Array<[string, number]>
  success: Array<[string, unknown]>
  failure: Array<[string, string]>
  retry: Array<[string, number, number]>
}

/** 造一个只记录调用、不真正执行的 hooks */
function makeHooks(overrides: Partial<TaskQueueHooks> = {}): {
  hooks: TaskQueueHooks
  calls: RecordedCalls
} {
  const calls: RecordedCalls = {
    start: [],
    progress: [],
    success: [],
    failure: [],
    retry: [],
  }
  const hooks: TaskQueueHooks = {
    onStart: (id) => calls.start.push(id),
    onProgress: (id, p) => calls.progress.push([id, p]),
    onSuccess: (id, r) => calls.success.push([id, r]),
    onFailure: (id, e) => calls.failure.push([id, (e as Error).message]),
    onRetry: (id, n, d) => calls.retry.push([id, n, d]),
    isCancelled: () => false,
    run: async () => ({ ok: true }),
    ...overrides,
  }
  return { hooks, calls }
}

function job(taskId: string, priority: TaskJob['priority'] = 'normal'): TaskJob {
  return { taskId, domain: 'flood-areas', route: '/flood-analysis', priority, params: {} }
}

describe('TaskRegistry', () => {
  it('patch 只改存在的记录；不存在返回 undefined', () => {
    const registry = makeRegistry()
    registry.add(record('t1'))
    expect(registry.patch('t1', { status: 'running' })?.status).toBe('running')
    expect(registry.patch('nope', { status: 'done' })).toBeUndefined()
  })

  it('🔴 进入终态自动补 finishedAt（不依赖调用方记得写）', () => {
    const registry = makeRegistry()
    registry.add(record('t1'))
    expect(registry.get('t1')?.finishedAt).toBeUndefined()
    registry.patch('t1', { status: 'done' })
    expect(typeof registry.get('t1')?.finishedAt).toBe('number')

    // 显式传入的 finishedAt 不被覆盖
    registry.add(record('t2'))
    registry.patch('t2', { status: 'failed', finishedAt: 12345 })
    expect(registry.get('t2')?.finishedAt).toBe(12345)
  })

  it('sweep 只回收「终态且超 TTL」的记录，活跃任务不受影响', () => {
    const registry = makeRegistry()
    const old = Date.now() - 60 * 60 * 1000 // 1 小时前
    registry.add(record('done-old', { status: 'done', createdAt: old, finishedAt: old }))
    registry.add(
      record('done-new', { status: 'done', createdAt: Date.now(), finishedAt: Date.now() })
    )
    registry.add(record('running-old', { status: 'running', createdAt: old }))
    registry.add(record('pending-old', { status: 'pending', createdAt: old }))

    expect(registry.sweep()).toBe(1)
    expect(registry.get('done-old')).toBeUndefined()
    expect(registry.get('done-new')).toBeDefined()
    // 活跃任务即使很老也不回收（它还在跑，清掉会让前端拿到 404）
    expect(registry.get('running-old')).toBeDefined()
    expect(registry.get('pending-old')).toBeDefined()
  })

  it('activeCount 只数 pending/running/retrying（终态不占队列）', () => {
    const registry = makeRegistry()
    registry.add(record('a', { status: 'pending' }))
    registry.add(record('b', { status: 'running' }))
    registry.add(record('c', { status: 'retrying' }))
    registry.add(record('d', { status: 'done' }))
    registry.add(record('e', { status: 'failed' }))
    registry.add(record('f', { status: 'cancelled' }))
    expect(registry.activeCount()).toBe(3)
  })

  it('dispose 清表并停定时器', () => {
    const registry = makeRegistry()
    registry.add(record('t1'))
    registry.startSweeper()
    registry.dispose()
    expect(registry.size).toBe(0)
    // dispose 可重入（onModuleDestroy 可能被调多次）
    expect(() => registry.dispose()).not.toThrow()
  })
})

describe('TaskQueue', () => {
  it('🔴 enqueue 返回的位次在 kick 之前算（不会因 drain 抢先 shift 而变 0）', async () => {
    const { hooks } = makeHooks({
      run: async () => {
        await sleep(50)
        return {}
      },
    })
    const queue = new TaskQueue(hooks)
    // 第一个任务会立刻被消费（但 drain 的第一个 await 之前已 shift）
    const first = queue.enqueue(job('t1'))
    const second = queue.enqueue(job('t2'))
    expect(first).toBe(1)
    // t2 应排在 t1 之后 ⇒ 位次 1（t1 已被取走）
    expect(second).toBe(1)
    await sleep(80)
    // t2 完成后队列空
    expect(queue.pendingCount).toBe(0)
  })

  it('high 插队首：后入队的 high 抢到比已入队 normal 更前面的位次', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    const { hooks } = makeHooks({
      run: async () => {
        await gate
        return {}
      },
    })
    const queue = new TaskQueue(hooks)

    queue.enqueue(job('leader')) // 立刻占住执行位
    await sleep(10)
    queue.enqueue(job('normal-1', 'normal'))
    queue.enqueue(job('normal-2', 'normal'))
    queue.enqueue(job('high-1', 'high'))

    // 队列内部顺序：high-1 插在队首，然后 normal-1、normal-2
    expect(queue.positionOf('high-1')).toBe(1)
    expect(queue.positionOf('normal-1')).toBe(2)
    expect(queue.positionOf('normal-2')).toBe(3)

    release()
    await sleep(30)
  })

  it('positionOf 对不在队列中的任务返回 undefined', () => {
    const { hooks } = makeHooks()
    const queue = new TaskQueue(hooks)
    expect(queue.positionOf('ghost')).toBeUndefined()
  })

  it('remove 能移出尚未开始的任务（取消的基础）', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    const { hooks, calls } = makeHooks({
      run: async (j) => {
        if (j.taskId === 'leader') await gate
        return {}
      },
    })
    const queue = new TaskQueue(hooks)
    queue.enqueue(job('leader'))
    await sleep(10)
    queue.enqueue(job('victim'))

    expect(queue.pendingCount).toBe(1)
    expect(queue.remove('victim')).toBe(true)
    expect(queue.pendingCount).toBe(0)

    release()
    await sleep(30)
    // 🔴 victim 的 handler 从未被调用
    expect(calls.start).not.toContain('victim')
    expect(calls.success.map((c) => c[0])).not.toContain('victim')
  })

  it('remove 对已在执行/不存在的任务返回 false', async () => {
    const { hooks } = makeHooks()
    const queue = new TaskQueue(hooks)
    expect(queue.remove('ghost')).toBe(false)
  })

  it('🔴 串行：三个任务不重叠执行（同一时刻只有一个在飞）', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const order: string[] = []
    const { hooks } = makeHooks({
      run: async (j) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        order.push(`+${j.taskId}`)
        await sleep(20)
        order.push(`-${j.taskId}`)
        inFlight--
        return {}
      },
    })
    const queue = new TaskQueue(hooks)
    queue.enqueue(job('a'))
    queue.enqueue(job('b'))
    queue.enqueue(job('c'))

    await sleep(150)
    expect(maxInFlight).toBe(1)
    // 严格串行 ⇒ 进出成对且不交错
    expect(order).toEqual(['+a', '-a', '+b', '-b', '+c', '-c'])
  })

  it('成功：onStart → onProgress → onSuccess，且不触发 retry/failure', async () => {
    const { hooks, calls } = makeHooks({ run: async () => ({ value: 7 }) })
    const queue = new TaskQueue(hooks)
    queue.enqueue(job('t1'))
    await sleep(30)

    expect(calls.start).toEqual(['t1'])
    expect(calls.progress).toEqual([['t1', 0.1]])
    expect(calls.success).toEqual([['t1', { value: 7 }]])
    expect(calls.retry).toEqual([])
    expect(calls.failure).toEqual([])
  })

  it('🔴 失败重试：退避 300/600/1200，共 3 次重试后 onFailure', async () => {
    const attempts: number[] = []
    const delays: number[] = []
    const { hooks, calls } = makeHooks({
      run: async () => {
        attempts.push(attempts.length + 1)
        throw new Error('boom')
      },
      onRetry: (id, n, d) => {
        delays.push(d)
        calls.retry.push([id, n, d])
      },
    })
    const queue = new TaskQueue(hooks)
    queue.enqueue(job('t1'))
    await sleep(TASK_RETRY_BACKOFF_MS.reduce((a, b) => a + b, 0) + 200)

    expect(attempts).toHaveLength(4) // 首次 + 3 次重试
    expect(delays).toEqual([300, 600, 1200])
    expect(calls.retry.map((c) => c[1])).toEqual([1, 2, 3])
    expect(calls.failure).toEqual([['t1', 'boom']])
    expect(calls.success).toEqual([])
  })

  it('重试期间成功 ⇒ retryCount=1 且不再重试', async () => {
    let n = 0
    const { hooks, calls } = makeHooks({
      run: async () => {
        n++
        if (n === 1) throw new Error('首次抖动')
        return { recovered: true }
      },
    })
    const queue = new TaskQueue(hooks)
    queue.enqueue(job('t1'))
    await sleep(500)

    expect(calls.retry).toHaveLength(1)
    expect(calls.success).toEqual([['t1', { recovered: true }]])
    expect(calls.failure).toEqual([])
  })

  it('🔴 执行前已取消 ⇒ 完全不启动（不调 onStart）', async () => {
    const { hooks, calls } = makeHooks({ isCancelled: () => true })
    const queue = new TaskQueue(hooks)
    queue.enqueue(job('t1'))
    await sleep(30)

    expect(calls.start).toEqual([])
    expect(calls.success).toEqual([])
    expect(calls.failure).toEqual([])
  })

  it('🔴 执行中变取消 ⇒ 结果被丢弃（不写 onSuccess）', async () => {
    let cancelled = false
    const { hooks, calls } = makeHooks({
      isCancelled: () => cancelled,
      run: async () => {
        cancelled = true // 模拟「跑的过程中用户点了取消」
        return { stale: true }
      },
    })
    const queue = new TaskQueue(hooks)
    queue.enqueue(job('t1'))
    await sleep(30)

    expect(calls.start).toEqual(['t1'])
    expect(calls.success).toEqual([]) // 结果被丢弃
    expect(calls.failure).toEqual([]) // 也不该报错
  })

  it('取消发生在重试等待期间 ⇒ 停止重试', async () => {
    let cancelled = false
    const { hooks, calls } = makeHooks({
      isCancelled: () => cancelled,
      run: async () => {
        cancelled = true
        throw new Error('boom')
      },
    })
    const queue = new TaskQueue(hooks)
    queue.enqueue(job('t1'))
    // 第一次失败后进入 300ms 退避；期间 isCancelled 变 true
    await sleep(500)
    expect(calls.retry).toHaveLength(1)
    expect(calls.failure).toEqual([]) // 取消后不再判失败
  })

  it('🔥 回归：消费循环归位后仍处理「循环出口与 finally 之间」新入队的任务', async () => {
    // 这个窗口很窄：drain 的 while 条件判为 false（队列空）→ 进入 finally 前，
    // 若有任务入队且此时 draining 还是 true，kick 会被挡掉。
    // 实现里 finally 内补了一次 kick，本测试盯住它不被删掉。
    const { hooks, calls } = makeHooks({
      run: async (j) => {
        await sleep(10)
        return { id: j.taskId }
      },
    })
    const queue = new TaskQueue(hooks)

    // 让 drain 跑起来，并在它即将退出的时机注入新任务
    queue.enqueue(job('a'))
    await sleep(12)
    queue.enqueue(job('b'))
    await sleep(12)
    queue.enqueue(job('c'))
    await sleep(60)

    expect(calls.success.map((c) => c[0]).sort()).toEqual(['a', 'b', 'c'])
    expect(queue.pendingCount).toBe(0)
  })

  it('onFailure 收到的是 Error 实例（非 Error 抛出值被包装）', async () => {
    const captured: string[] = []
    const { hooks } = makeHooks({
      run: async () => {
        // 故意抛非 Error：验证队列的 `error instanceof Error` 包装分支真的生效
        //（下游若 reject 一个字符串/对象，不包装的话 onFailure 拿到的 message 会是 undefined）
        return Promise.reject('plain string')
      },
      onFailure: (_id, e) => captured.push((e as Error).message),
    })
    const queue = new TaskQueue(hooks)
    queue.enqueue(job('t1'))
    await sleep(TASK_RETRY_BACKOFF_MS.reduce((a, b) => a + b, 0) + 200)
    expect(captured).toEqual(['plain string'])
  })

  it('drain 结束后队列清空且 isBusy 归位', async () => {
    const { hooks } = makeHooks({ run: async () => ({}) })
    const queue = new TaskQueue(hooks)
    queue.enqueue(job('t1'))
    await sleep(30)
    expect(queue.isBusy).toBe(false)
    expect(queue.pendingCount).toBe(0)
  })

  it('空闲时 kick 是空操作（不产生空转）', async () => {
    const run = vi.fn()
    const { hooks } = makeHooks({ run })
    const queue = new TaskQueue(hooks)
    queue.kick()
    queue.kick()
    await sleep(10)
    expect(run).not.toHaveBeenCalled()
    expect(queue.isBusy).toBe(false)
  })
})

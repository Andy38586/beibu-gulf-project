import { Logger } from '@nestjs/common'

import {
  TASK_CONCURRENCY,
  TASK_RETRY_BACKOFF_MS,
  type TaskDomain,
  type TaskPriority,
} from '../types/task'

/** 队列项：任务执行所需的最小信息（不含状态，状态在注册表中） */
export interface TaskJob {
  taskId: string
  domain: TaskDomain
  route: string
  priority: TaskPriority
  params: Record<string, unknown>
}

/** 任务生命周期钩子——由 TaskService 提供，队列只负责「什么时候调」，不负责「调完写什么」 */
export interface TaskQueueHooks {
  /** 即将执行（注册表 status → running，进度归零） */
  onStart: (taskId: string) => void
  /** 执行中途上报（阶段式进度，见 TaskService 注释） */
  onProgress: (taskId: string, progress: number) => void
  /** 成功 */
  onSuccess: (taskId: string, result: unknown) => void
  /** 失败且重试机会已耗尽 */
  onFailure: (taskId: string, error: Error) => void
  /** 进入第 n 次重试前的等待（n 从 1 开始）；用于注册表写 'retrying' + retryCount */
  onRetry: (taskId: string, attempt: number, delayMs: number) => void
  /** 任务是否已被取消（每步检查一次；取消不打断已在飞的 await，但阻止后续步骤） */
  isCancelled: (taskId: string) => boolean
  /** 取执行器 */
  run: (job: TaskJob) => Promise<unknown>
}

/**
 * 串行任务队列（口径 #15/#16）。
 *
 * 🔴 **为什么必须串行**：用户把路由 A 的面板拖进 dock（后台排队跑），又在路由 B 上操作
 * 面板 ⇒ 两个任务会同时打 PostGIS。线上是 1.6G 内存的单机，两头压只会让两个任务都变慢
 *（淹没裁剪是 CPU 型，见项目记忆）⇒ 造成「谁都没算完」。串行 + 当前路由插队，
 * 保证**用户正在看的那件事**总是最快出结果。
 *
 * 🔴 **为什么用数组而不是 setInterval 轮询**：唤醒式消费（`kick()`）既能保证
 * 「提交后立刻可能开始跑」（低延迟），又能在空闲时完全不占 CPU（无空转定时器）。
 * `draining` 标志防「多个 kick 并发进入消费循环」⇒ 串行被破坏。
 */
export class TaskQueue {
  private readonly logger = new Logger(TaskQueue.name)
  private readonly queue: TaskJob[] = []
  private draining = false

  constructor(private readonly hooks: TaskQueueHooks) {}

  /** 当前排队数（不含正在跑的） */
  get pendingCount(): number {
    return this.queue.length
  }

  /** 是否正在执行 */
  get isBusy(): boolean {
    return this.draining
  }

  /**
   * 入队并唤醒消费循环。
   * priority='high' ⇒ **插队首**（口径 #16：当前路由的任务优先）。
   * 注意插在队首而非「抢占正在跑的」——正在跑的无法安全中断（没有取消点），
   * 强行抢占只会留下半个结果，比晚一点更糟。
   */
  enqueue(job: TaskJob): number {
    if (job.priority === 'high') {
      this.queue.unshift(job)
    } else {
      this.queue.push(job)
    }
    // 🔴 位次必须在 kick() **之前**算：kick 会同步执行到 drain 循环里第一个 await 之前的
    // `shift()`（async 函数的同步段），任务已被移出队列 ⇒ 之后算位次会拿到 undefined，
    // 落到 fallback 上给出 0，前端就会显示「排队第 0 位」（实测踩过）。
    const position = this.positionOf(job.taskId) ?? this.queue.length
    this.kick()
    return position
  }

  /** 查询排队位次（1 = 下一个执行）；不在队列中返回 undefined */
  positionOf(taskId: string): number | undefined {
    const index = this.queue.findIndex((job) => job.taskId === taskId)
    return index < 0 ? undefined : index + 1
  }

  /**
   * 移除队列中的任务（取消：仅对**尚未开始**的任务有效）。
   * @returns 是否真的移除了（false = 已经在跑 / 不在队列）
   */
  remove(taskId: string): boolean {
    const index = this.queue.findIndex((job) => job.taskId === taskId)
    if (index < 0) return false
    this.queue.splice(index, 1)
    return true
  }

  /** 唤醒消费循环（无任务或在跑时是空操作） */
  kick(): void {
    if (this.draining) return
    if (this.queue.length === 0) return
    void this.drain()
  }

  /**
   * 消费循环：串行执行，一次一个。
   *
   * 结构说明：`draining` 在 finally 里归位 —— 这一步很关键。若在循环出口处归位，
   * 则 `finally` 与出口之间的新任务会看到 `draining=true` 而被永久搁置
   *（「队列有任务但没人消费」的静默卡死）。归位后再 kick 一次兜住这个窗口。
   *
   * TASK_CONCURRENCY 固定是 1，这里写成循环内 while + 常量判断，是为了让「如果将来
   * 要放开并发，改哪里」显式可见；当前**不允许**改（总纲 §四明确串行）。
   */
  private async drain(): Promise<void> {
    this.draining = true
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift()
        if (!job) break
        await this.execute(job)
        // 串行上限：即使将来 TASK_CONCURRENCY 变大，这个 await 也保证了一次只有一个在飞
        if (TASK_CONCURRENCY <= 0) break
      }
    } finally {
      this.draining = false
      // 兜底：消费期间可能又有任务进来（此时 kick 因 draining=true 被挡掉）
      if (this.queue.length > 0) this.kick()
    }
  }

  /** 执行单个任务：含重试（指数退避 300/600/1200） */
  private async execute(job: TaskJob): Promise<void> {
    // 取消可能发生在「出队前但已被标记取消」的瞬间
    if (this.hooks.isCancelled(job.taskId)) return

    this.hooks.onStart(job.taskId)

    for (let attempt = 0; attempt <= TASK_RETRY_BACKOFF_MS.length; attempt++) {
      if (this.hooks.isCancelled(job.taskId)) return
      try {
        const result = await this.runOnce(job)
        if (this.hooks.isCancelled(job.taskId)) return
        this.hooks.onSuccess(job.taskId, result)
        return
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        const delay = TASK_RETRY_BACKOFF_MS[attempt]

        if (delay === undefined) {
          // 重试机会耗尽 ⇒ 终态失败。日志留全栈，前端只拿到 message
          this.logger.warn(`任务 ${job.taskId}（${job.domain}）重试耗尽：${err.message}`)
          this.hooks.onFailure(job.taskId, err)
          return
        }

        this.hooks.onRetry(job.taskId, attempt + 1, delay)
        this.logger.warn(
          `任务 ${job.taskId}（${job.domain}）第 ${attempt + 1} 次失败，${delay}ms 后重试：${err.message}`
        )
        await sleep(delay)
      }
    }
  }

  /**
   * 单次执行 = 调 handler + 上报进度。
   *
   * ⚠️ **进度是「阶段式」的（0 → 0.1 → 1），不是真实百分比**——底层 service 是
   * `await postgis()` 一把梭，中间没有可切分的进度点。伪造一条平滑增长曲线是欺骗：
   * 用户看到 60% 却在 60% 处卡三分钟，比看到一个诚实的「进行中」更糟。
   * 真要做连续进度，需要改各域 repository 暴露分步回调——那是独立议题，不在 v4 范围。
   * 前端进度环因此应表达为「有进展」而非「精确到百分之几」。
   */
  private async runOnce(job: TaskJob): Promise<unknown> {
    this.hooks.onProgress(job.taskId, 0.1)
    return this.hooks.run(job)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

import {
  TASK_QUEUE_LIMIT,
  TASK_SWEEP_INTERVAL_MS,
  TASK_TTL_MS,
  type TaskRecord,
  type TaskStatus,
} from '../types/task'

/** 任务进入终态后仍保留在注册表中的时长（便于前端轮询到结果后再被回收） */
const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(['done', 'failed', 'cancelled'])

/**
 * 任务注册表：进程内内存 Map（总纲 §四 B-1 方案）。
 *
 * 🔴 为什么不引 Redis / BullMQ：2026-09-18 实测线上接口耗时全在 1.2s 内
 *（flood-areas 0.616s / route-path 0.888~1.208s）⇒ **后台任务是被「跨路由保活」逼出来的，
 * 不是被「慢」逼出来的**。为这个需求引入外部依赖（多一个容器 + 部署链改造 + 1.6G 内存配额
 * 再分一杯羹）性价比为负；进程内注册表即可满足。
 *
 * 已知代价（必须知情）：
 *   · 多实例部署时任务**不共享**（取不到别人的 taskId）。当前是单实例 SWAS，成立；
 *     未来横向扩容需把本类换成 Redis 实现——所有读写都收在本类内部，替换面已收敛。
 *   · 重启即丢任务。任务本身是「用户主动发起的短时计算」，重放代价远低于持久化成本。
 */
export class TaskRegistry {
  private readonly records = new Map<string, TaskRecord>()
  private sweeper: NodeJS.Timeout | null = null

  /** 任务总数（含终态未回收的），用于队列容量判定 */
  get size(): number {
    return this.records.size
  }

  /** 进入内存：创建时即登记，避免「已接受但查不到」的窗口 */
  add(record: TaskRecord): void {
    this.records.set(record.taskId, record)
  }

  get(taskId: string): TaskRecord | undefined {
    return this.records.get(taskId)
  }

  /**
   * 🔴 **只允许通过本方法改字段**：直接 `record.status = ...` 也能写，但那会绕过
   * 「终态补 finishedAt」这一条不变量，导致前端拿到没有结束时间的任务。
   */
  patch(taskId: string, changes: Partial<TaskRecord>): TaskRecord | undefined {
    const record = this.records.get(taskId)
    if (!record) return undefined
    Object.assign(record, changes)
    // 终态必须带 finishedAt：前端进度环据此停止动画、结果面板据此判定「跑完了」
    if (TERMINAL_STATUSES.has(record.status) && record.finishedAt === undefined) {
      record.finishedAt = Date.now()
    }
    return record
  }

  /** 按状态枚举（队列消费时取 pending、清扫时取终态） */
  list(): TaskRecord[] {
    return [...this.records.values()]
  }

  /**
   * 回收：终态且已超 TTL 的记录。
   * 返回被回收的数量仅为可测性（单测断言「过期的真被清了」），业务侧不需要。
   */
  sweep(now = Date.now()): number {
    let removed = 0
    for (const [taskId, record] of this.records) {
      if (!TERMINAL_STATUSES.has(record.status)) continue
      const finishedAt = record.finishedAt ?? record.createdAt
      if (now - finishedAt >= TASK_TTL_MS) {
        this.records.delete(taskId)
        removed++
      }
    }
    return removed
  }

  /**
   * 启动定时清扫。**由 TaskService 在模块初始化时调用**（而非构造函数），
   * 否则单测里每次 new 出一个 registry 都会留下一个永不释放的 interval，
   * vitest 会以「进程不退出」的形式报出来。
   */
  startSweeper(): void {
    if (this.sweeper) return
    this.sweeper = setInterval(() => this.sweep(), TASK_SWEEP_INTERVAL_MS)
    // 定时器不该拖住进程退出（Node 容器收到 SIGTERM 时要能干净地走）
    this.sweeper.unref?.()
  }

  /** 停机：清表 + 停定时器（Nest onModuleDestroy 调用） */
  dispose(): void {
    if (this.sweeper) {
      clearInterval(this.sweeper)
      this.sweeper = null
    }
    this.records.clear()
  }

  /** 队列容量预检：pending + running/retrying 的任务数（终态不占队列） */
  activeCount(): number {
    let count = 0
    for (const record of this.records.values()) {
      if (
        record.status === 'pending' ||
        record.status === 'running' ||
        record.status === 'retrying'
      )
        count++
    }
    return count
  }

  isQueueFull(): boolean {
    return this.activeCount() >= TASK_QUEUE_LIMIT
  }
}

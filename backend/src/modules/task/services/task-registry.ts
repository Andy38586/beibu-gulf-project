import {
  TASK_QUEUE_LIMIT,
  TASK_REGISTRY_MAX_BYTES,
  TASK_REGISTRY_MAX_RECORDS,
  TASK_SWEEP_INTERVAL_MS,
  TASK_TERMINAL_MIN_RETAIN_MS,
  TASK_TTL_MS,
  type TaskRecord,
  type TaskStatus,
} from '../types/task'

/** 任务进入终态后仍保留在注册表中的时长（便于前端轮询到结果后再被回收） */
const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(['done', 'failed', 'cancelled'])

/**
 * 结果体字节估算（d060 的字节维度）。
 *
 * 为什么不 `JSON.stringify(result).length`：结果可达数十 MB，序列化要**另分配**一份等长
 * 字符串——在「判断内存够不够」的路径上再要一块同样大的内存，是自相矛盾的。此处只按结构
 * 遍历累加：字符串按 UTF-16 双字节计（保守，宁可高估），数值/布尔 8 字节，容器累加键与元素。
 * 深度封顶 8 层：病态深结构按「深到无意义」处理，不为此爆栈。
 */
function estimateResultBytes(value: unknown, depth = 0): number {
  if (value === null || value === undefined) return 0
  const type = typeof value
  if (type === 'string') return (value as string).length * 2
  if (type === 'number' || type === 'boolean' || type === 'bigint') return 8
  if (depth >= 8) return 0
  if (Array.isArray(value)) {
    let bytes = 0
    for (const item of value) bytes += estimateResultBytes(item, depth + 1)
    return bytes
  }
  if (type === 'object') {
    let bytes = 0
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      bytes += key.length * 2 + estimateResultBytes(item, depth + 1)
    }
    return bytes
  }
  return 0
}

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
/** 容量上限（可注入**仅为单测**用小数值验证「淘汰 / 拒绝」两条路径，默认即生产值） */
interface TaskRegistryLimits {
  maxRecords: number
  maxBytes: number
  minRetainMs: number
}

const DEFAULT_LIMITS: TaskRegistryLimits = {
  maxRecords: TASK_REGISTRY_MAX_RECORDS,
  maxBytes: TASK_REGISTRY_MAX_BYTES,
  minRetainMs: TASK_TERMINAL_MIN_RETAIN_MS,
}

export class TaskRegistry {
  private readonly records = new Map<string, TaskRecord>()
  private sweeper: NodeJS.Timeout | null = null
  /** 累计结果字节（增量维护，避免每次容量判定都 O(n) 重算） */
  private bytes = 0
  private readonly limits: TaskRegistryLimits

  constructor(limits: Partial<TaskRegistryLimits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits }
  }

  /** 任务总数（含终态未回收的），用于队列容量判定 */
  get size(): number {
    return this.records.size
  }

  /** 累计结果体字节（d060：容量判定的第三个维度） */
  get totalBytes(): number {
    return this.bytes
  }

  /** 进入内存：创建时即登记，避免「已接受但查不到」的窗口 */
  add(record: TaskRecord): void {
    this.records.set(record.taskId, record)
    record.resultBytes = estimateResultBytes(record.result)
    this.bytes += record.resultBytes
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
    // 字节账目：result 变则先扣旧值、再记新值（其余字段变更不触碰账目）
    if ('result' in changes) {
      this.bytes -= record.resultBytes ?? 0
      record.resultBytes = undefined
    }
    Object.assign(record, changes)
    if ('result' in changes) {
      record.resultBytes = estimateResultBytes(record.result)
      this.bytes += record.resultBytes
    }
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
    for (const record of [...this.records.values()]) {
      if (!TERMINAL_STATUSES.has(record.status)) continue
      const finishedAt = record.finishedAt ?? record.createdAt
      if (now - finishedAt >= TASK_TTL_MS) {
        this.drop(record)
        removed++
      }
    }
    return removed
  }

  /**
   * 容量超限时淘汰**最旧的终态记录**（d060）：丢的是「已算完且过了最小保留窗」的结果缓存，
   * 不是任何在跑的计算。活跃记录一律不动（它们还占着队列位与并发槽）。
   *
   * 与 `sweep()` 的分工：sweep 是时间驱动（TTL 到点就清），本方法是容量驱动
   * （内存吃紧时提前丢最旧的）——没有它，终态结果会在 TTL 窗内无界堆积。
   *
   * @returns 被淘汰的条数（可测性；业务侧不需要）
   */
  trimTerminal(now = Date.now()): number {
    let removed = 0
    for (;;) {
      if (!this.recordsOverLimit && !this.bytesOverLimit) break
      const victim = this.oldestEvictableTerminal(now)
      if (!victim) break // 剩下的全是活跃记录或还在最小保留窗内 ⇒ 交回调用方拒绝新提交
      this.drop(victim)
      removed++
    }
    return removed
  }

  /**
   * 条数/字节两维的容量判定（d060）。活跃维度仍由 `isQueueFull()` 负责。
   * @returns 超限原因文案；未超限返回 undefined
   */
  capacityProblem(): string | undefined {
    if (this.recordsOverLimit) {
      return `任务记录数已达上限（${this.limits.maxRecords}），请稍后重试`
    }
    if (this.bytesOverLimit) {
      const limitMb = Math.round(this.limits.maxBytes / 1024 / 1024)
      return `任务结果占用内存已达上限（${limitMb}MB），请稍后重试`
    }
    return undefined
  }

  /**
   * 条数是否已满——判据含**即将入表的这一条**（否则 trim 到 128 后新记录把表顶到 129，
   * 上限就永远慢一步）。返回值即「再收一条会不会超」。
   */
  private get recordsOverLimit(): boolean {
    return this.size + 1 > this.limits.maxRecords
  }

  private get bytesOverLimit(): boolean {
    return this.bytes > this.limits.maxBytes
  }

  /** 最旧的、可按容量淘汰的终态记录（排除最小保留窗内的：用户可能正在轮询取结果） */
  private oldestEvictableTerminal(now: number): TaskRecord | undefined {
    let victim: TaskRecord | undefined
    for (const record of this.records.values()) {
      if (!TERMINAL_STATUSES.has(record.status)) continue
      const finishedAt = record.finishedAt ?? record.createdAt
      if (now - finishedAt < this.limits.minRetainMs) continue
      if (!victim || finishedAt < (victim.finishedAt ?? victim.createdAt)) victim = record
    }
    return victim
  }

  /** 删除单条并同步字节账目（所有删除路径的唯一出口） */
  private drop(record: TaskRecord): void {
    this.records.delete(record.taskId)
    this.bytes -= record.resultBytes ?? 0
  }

  /**
   * 启动定时节拍。**由 TaskService 在模块初始化时调用**（而非构造函数），
   * 否则单测里每次 new 出一个 registry 都会留下一个永不释放的 interval，
   * vitest 会以「进程不退出」的形式报出来。
   *
   * `onTick` 是给 TaskService 挂的额外周期职责（排队超时判定）——定时器生命周期
   * 仍由本类持有，`dispose()` 一处停掉，不让调用方各自留 interval。
   */
  startSweeper(onTick?: () => void): void {
    if (this.sweeper) return
    this.sweeper = setInterval(() => {
      this.sweep()
      onTick?.()
    }, TASK_SWEEP_INTERVAL_MS)
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
    this.bytes = 0
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

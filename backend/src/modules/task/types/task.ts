// v4 异步任务体系的类型与常量（后端）
//
// 设计依据：docs/v4-总纲设计-2026-09-18.md §四（系统 B）。
// 定位：task 域是**编排层**，不承载任何业务计算——真实计算一律委托给各业务域的 service
//（route/flood/forecast），本域只负责「排队 → 执行 → 重试 → 记录 → 回收」。
//
// 🔴 为什么需要它（口径 #5/#10）：任务要能在用户切走路由后继续跑完 ⇒ 任务的生命周期
// 必须长于 HTTP 请求。同步的 `await service.xxx()` 做不到这点（连接断了就没了），
// 所以改成「POST 立即返回 taskId，计算在服务端后台推进」。

/** 任务状态机：pending → running → (retrying →) done | failed | cancelled */
export type TaskStatus = 'pending' | 'running' | 'retrying' | 'done' | 'failed' | 'cancelled'

/**
 * 优先级（口径 #16：当前路由插队）。
 * high = 发起时用户正看着这个路由 ⇒ 插队首；normal = 后台路由 ⇒ 排队尾。
 */
export type TaskPriority = 'high' | 'normal'

/**
 * 任务提交域：一个域对应一个可执行的业务能力（映射见 TaskHandlers.table）。
 *
 * 🔴 单一事实源（2026-09-19 修复）：枚举由本数组派生 ⇒ 新增域只需改这一处；
 * `TaskHandlers.table` 是 `Record<TaskDomain, TaskHandler>`，漏配 handler 会编译报错；
 * `HTTP_TASK_DOMAINS` 亦由本数组派生。此前枚举与 DTO 白名单各写一份且不一致，
 * 导致 forecast-map 任务恒 400（热力图永久无数据）。
 */
export const TASK_DOMAINS = [
  'flood-areas',
  'route-path',
  'forecast-timeseries',
  'forecast-map',
  'site-suitability-map',
] as const

export type TaskDomain = (typeof TASK_DOMAINS)[number]

export interface TaskError {
  message: string
  bizCode?: number
}

/**
 * 匿名提交者的属主标识（d059）。
 *
 * 三个端点免鉴权（纯计算不读用户数据），故「无令牌」不是错误，而是一种真实身份：
 * 所有匿名请求同属这一个槽位。已登录请求按 JWT 里的用户 id 分属主。
 */
export const ANONYMOUS_OWNER = 'anonymous'

/** 注册表内的任务记录（**含 result**，是完整记录；对外响应是它的投影） */
export interface TaskRecord {
  taskId: string
  domain: TaskDomain
  /** 发起任务的前端路由（如 '/flood-analysis'）——前端按 route 分槽的依据（不变式 I8） */
  route: string
  /**
   * 提交者属主（d059）：JWT 用户 id，无令牌则为 ANONYMOUS_OWNER。
   *
   * 🔴 取代判定与取消/查询都必须带它——只按 route 判定时，任何人提交同一 route
   * 即可取消他人任务（route 是客户端任意字符串，不需知 taskId）。
   */
  ownerId: string
  priority: TaskPriority
  params: Record<string, unknown>
  status: TaskStatus
  /** 0~1。当前实现是「阶段式」上报（见 progress 字段注释），非连续插值 */
  progress: number
  /** 当前排队位次（1 = 下一个执行）；仅 status='pending' 时有意义 */
  queuePosition?: number
  /** 已重试次数（0 = 未曾重试）。🔴 前端不得把这个数字暴露给用户（口径 #17） */
  retryCount: number
  result?: unknown
  /**
   * result 的估算字节数（d060）：内存大头只有结果体，容量判定必须有字节维度。
   * 估算而非 JSON.stringify（后者在数十 MB 结果上要另分配一份等长字符串）；不对外下发。
   */
  resultBytes?: number
  error?: TaskError
  /** 内部记录字段（epoch-ms）；对外投影下发为 `createdAtMs`（见 TaskView，跨域同名异义收口 1004-F11） */
  createdAt: number
  startedAt?: number
  finishedAt?: number
}

/** 对外响应投影：字段裁剪 + 排队位次实时计算（不落库，避免注册表与队列两份状态） */
export interface TaskView {
  taskId: string
  domain: TaskDomain
  route: string
  status: TaskStatus
  progress: number
  queuePosition?: number
  retryCount: number
  result?: unknown
  error?: TaskError
  /** epoch-ms；与 plans/users 的 ISO string `createdAt` 同名异义，故对外用 Ms 后缀（1004-F11） */
  createdAtMs: number
  startedAt?: number
  finishedAt?: number
}

/** 提交响应：比 TaskView 多一个 queuePosition（提交当下就该告诉用户排在第几位） */
export interface TaskSubmitResponse {
  taskId: string
  status: TaskStatus
  queuePosition: number
  /** epoch-ms（同 TaskView.createdAtMs 口径，1004-F11） */
  createdAtMs: number
}

// ── 常量 ────────────────────────────────────────────────────────────────────

/**
 * 并发上限。**固定为 1 = 串行**（口径 #15：不与前端当前路由抢线程，且避免 PG 被两头压）。
 * 提成常量只为让下一个人一眼看到「这是被写死的设计决策，不是随手写错」。
 */
export const TASK_CONCURRENCY = 1

/**
 * 队列容量上限。超出直接拒绝（503 语义），而不是无界堆积——
 * 1.6G 内存的线上机器经不起无界队列 + 无界结果集。
 */
export const TASK_QUEUE_LIMIT = 8

/**
 * 重试退避序列（毫秒，口径 #17：300/600/1200）。
 * 长度即「最多重试几次」——3 次；3 次后仍失败 ⇒ status='failed'。
 */
export const TASK_RETRY_BACKOFF_MS = [300, 600, 1200] as const

/**
 * 完成/失败/取消的任务保留时长（30 分钟）。
 * 到期由 TaskRegistry 的定时器回收 ⇒ 结果对象被 GC，内存不会随任务数单调增长。
 */
export const TASK_TTL_MS = 30 * 60 * 1000

/**
 * 注册表节拍（15 秒）。同一个 tick 承担两件事：回收超 TTL 的终态任务 + 排队超时判定。
 *
 * 🔴 间隔必须显著小于 `TASK_MAX_WAIT_MS`，否则"等待超 60s 即判失败"是句空话：
 * 原判据只把 tick 对齐到 TTL（5min = 30min/6），而 TTL 回收晚几分钟无所谓，
 * 排队判定晚 5 分钟却让前端整整转圈 5 分钟——串行队列并发上限 1，这期间全站任务都堵着。
 * sweep 本身是 O(size)（size ≤ 队列上限 + TTL 窗口内的终态数），提频成本可忽略。
 */
export const TASK_SWEEP_INTERVAL_MS = 15 * 1000

/** 排队等待上限：等待超过它即视为超时失败（防止队列被长任务堵死时前端永远转圈） */
export const TASK_MAX_WAIT_MS = 60 * 1000

// ── 注册表容量上限（d060 三重维度）──────────────────────────────────────────
// 原有判据只有「活跃数」（TASK_QUEUE_LIMIT），终态记录在 30 分钟 TTL 窗内
// 既不计条数也不计字节 ⇒ 单条结果可达数十 MB 时，几十条提交即可吃掉整机内存
//（1.6G 机器 ÷ 单条 28MB ≈ 57 条，进程内无界增长）。

/**
 * 注册表总条数上限（含 TTL 窗内的终态记录）。
 * 取 128：单实例单进程的任务表，活跃上限才 8，余量 16 倍；只防「无界」不防「正常使用」。
 */
export const TASK_REGISTRY_MAX_RECORDS = 128

/**
 * 注册表累计结果字节上限（64MB）。
 * 容器 mem_limit 是 192m（docker-compose.yml），PG 池 + Node 运行时之外留给结果对象
 * 的一半不到；超限即淘汰最旧终态（见 TASK_TERMINAL_MIN_RETAIN_MS），仍超则拒绝新提交。
 */
export const TASK_REGISTRY_MAX_BYTES = 64 * 1024 * 1024

/**
 * 终态记录的**最小保留时长**（60s）：容量超限时也不动比它更新的记录。
 *
 * 🔴 为什么需要它：终态记录正在被前端轮询取结果（500ms 间隔），刚算完就因容量压力被丢
 * ⇒ 用户拿到「任务不存在或已过期」而结果其实已经算出来了。保留窗内宁可拒绝新提交，
 * 也不丢用户正要取的结果。取 60s = 4 个 GC 节拍，且 ≤ TASK_MAX_WAIT_MS。
 */
export const TASK_TERMINAL_MIN_RETAIN_MS = 60 * 1000

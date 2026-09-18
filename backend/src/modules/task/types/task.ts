// v4 异步任务体系的类型与常量（后端）
//
// 设计依据：docs/v4-总纲设计-2026-09-18.md §四（系统 B）。
// 定位：task 域是**编排层**，不承载任何业务计算——真实计算一律委托给各业务域的 service
//（route/flood/forecast/site-analysis），本域只负责「排队 → 执行 → 重试 → 记录 → 回收」。
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

/** 任务提交域：一个域对应一个可执行的业务能力（映射见 TASK_DOMAIN_HANDLERS） */
export type TaskDomain = 'flood-areas' | 'route-path' | 'site-analysis' | 'forecast-timeseries'

export interface TaskError {
  message: string
  bizCode?: number
}

/** 注册表内的任务记录（**含 result**，是完整记录；对外响应是它的投影） */
export interface TaskRecord {
  taskId: string
  domain: TaskDomain
  /** 发起任务的前端路由（如 '/flood-analysis'）——前端按 route 分槽的依据（不变式 I8） */
  route: string
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
  error?: TaskError
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
  createdAt: number
  startedAt?: number
  finishedAt?: number
}

/** 提交响应：比 TaskView 多一个 queuePosition（提交当下就该告诉用户排在第几位） */
export interface TaskSubmitResponse {
  taskId: string
  status: TaskStatus
  queuePosition: number
  createdAt: number
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

/** 注册表清扫间隔（5 分钟）。取 TTL 的 1/6，保证回收延迟不超过 TTL 的 17%。 */
export const TASK_SWEEP_INTERVAL_MS = 5 * 60 * 1000

/** 排队等待上限：等待超过它即视为超时失败（防止队列被长任务堵死时前端永远转圈） */
export const TASK_MAX_WAIT_MS = 60 * 1000

/**
 * v4 异步任务的前端类型（与后端 `backend/src/modules/task/types/task.ts` 对齐）。
 *
 * 🔴 维护约束：两侧字段必须同步。后端是权威，前端是消费副本。
 * 若字段漂移，`GET /task/:id` 的 `result` 会静默取不到值——表现为「任务成功但没结果」，
 * 比报错更难查。改动后端 `TaskView` 时必须回到本文件同步。
 */

/** 任务状态机（与后端一致）：pending → running → (retrying →) done | failed | cancelled */
export type TaskStatus = 'pending' | 'running' | 'retrying' | 'done' | 'failed' | 'cancelled'

/** 优先级：当前路由 = high（插队首），后台路由 = normal（队尾） */
export type TaskPriority = 'high' | 'normal'

/** 可提交的任务域（与后端 TaskHandlers 支持的四个域一致，多一个都会被 400 拒绝） */
export type TaskDomain =
  | 'flood-areas'
  | 'route-path'
  | 'site-analysis'
  | 'forecast-timeseries'
  | 'forecast-map'

export interface TaskError {
  message: string
  bizCode?: number
}

/** `POST /task` 响应 */
export interface TaskSubmitResponse {
  taskId: string
  status: TaskStatus
  queuePosition: number
  createdAt: number
}

/** `GET /task/:id` 响应（后端 TaskView 的镜像） */
export interface TaskView {
  taskId: string
  domain: TaskDomain
  route: string
  status: TaskStatus
  /** 🔴 阶段式（0 → 0.1 → 1），**不是**真实百分比。见后端 task-queue.runOnce 注释 */
  progress: number
  /** 仅 status='pending' 时有值（1 = 下一个执行） */
  queuePosition?: number
  /** 🔴 已重试次数。**不得显示给用户**（口径 #17），只用于内部判断 */
  retryCount: number
  result?: unknown
  error?: TaskError
  createdAt: number
  startedAt?: number
  finishedAt?: number
}

/**
 * 前端 store 中的任务槽位（一个路由一个）。
 *
 * 与 TaskView 的差别：多了 `submitSeq`——**竞态守卫**。
 * 原来的 `analysisSeq` 长在页面里（`FloodAnalysisPage.vue:56`），页面卸载即失效；
 * 任务保活后必须在 store 里，否则「切走再切回」会让旧响应覆盖新状态。
 */
export interface TaskSlot {
  taskId: string
  /** 发起任务的前端路由（如 '/flood-analysis'），也是本槽位的 key */
  route: string
  domain: TaskDomain
  status: TaskStatus
  progress: number
  queuePosition?: number
  retryCount: number
  result?: unknown
  error?: TaskError
  createdAt: number
  startedAt?: number
  finishedAt?: number
  /** 提交序号：只让最新一次提交的结果落地（防止快速连续提交时旧响应后到覆盖新状态） */
  submitSeq: number
  /** 该槽位是否已被「拖进 dock」（true = 面板收起、任务在后台跑） */
  docked: boolean
}

/** 判断是否为终态（done/failed/cancelled 都不再变化，可停止轮询） */
export function isTerminalStatus(status: TaskStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled'
}

/** 判断是否为活跃态（还没跑完） */
export function isActiveStatus(status: TaskStatus): boolean {
  return status === 'pending' || status === 'running' || status === 'retrying'
}

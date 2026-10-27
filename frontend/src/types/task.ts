/**
 * v4 异步任务的前端类型。
 *
 * 🔴 权威源切换（必要性审判）：运行期常量与状态/域类型以
 * `backend/src/modules/task/types/task.ts` 为唯一权威源，前端从此处 re-export。
 * 前端只保留运行时无关的接口（TaskError 内嵌 TaskView/TaskSlot、TaskSlot 槽位结构）。
 * 改动后端 TaskView 字段时，本文件的 TaskView 镜像需同步（字段漂移会导致 GET /task/:id 的 result 静默取不到）。
 */

// ── 权威源 re-export（后端 task.ts 为唯一权威）─────────────────────────────
import type { TaskDomain, TaskStatus } from '@backend/modules/task/types/task'

export {
  TASK_STATUSES,
  TASK_DOMAINS,
  isActiveStatus,
  isTerminalStatus,
} from '@backend/modules/task/types/task'
export type {
  TaskStatus,
  TaskPriority,
  TaskDomain,
  TaskView,
  TaskSubmitResponse,
} from '@backend/modules/task/types/task'

// ── 前端独有类型 ──────────────────────────────────────────────────────────

/** 任务失败信息（只被本文件的 TaskView/TaskSlot 引用，2026-10-19 必要性审判收为模块内部） */
interface TaskError {
  message: string
  bizCode?: number
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
  createdAtMs: number
  startedAt?: number
  finishedAt?: number
  /** 提交序号：只让最新一次提交的结果落地（防止快速连续提交时旧响应后到覆盖新状态） */
  submitSeq: number
  /** 该槽位是否已被「拖进 dock」（true = 面板收起、任务在后台跑） */
  docked: boolean
}

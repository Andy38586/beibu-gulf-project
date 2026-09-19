import { TASK_DOMAINS, type TaskDomain, type TaskPriority } from '../types/task'

/**
 * 提交任务请求体。
 *
 * ⚠️ 本域是**唯一**不做参数级校验的域——`params` 的形状由目标域的 handler 自己判定
 *（见 TaskHandlers）。这里只校验「任务域是否受支持」「priority 白名单」「route 是否存在」，
 * 因为这些是 task 域自己的语言，与业务无关。
 *
 * DTO 写成 interface + 手写守卫（对齐项目既有 dto/*.ts 风格；项目无 class-validator）。
 */
export interface SubmitTaskBody {
  domain?: unknown
  route?: unknown
  priority?: unknown
  params?: unknown
}

/** 提交响应（controller 直接返回，EnvelopeInterceptor 会包成 {code,data}） */
export interface TaskSubmitPayload {
  taskId: string
  status: string
  queuePosition: number
  createdAt: number
}

export const TASK_PRIORITIES: readonly TaskPriority[] = ['high', 'normal'] as const

/**
 * 业务侧允许通过 HTTP 提交的域。
 *
 * 🔴 单一事实源（2026-09-19 修复）：直接取 `TASK_DOMAINS`——此前的第二份手写白名单
 * 只有 4 项而 `TaskDomain` 有 5 项，导致 `forecast-map` 提交恒被拒（400），
 * 预测页热力图永久无数据。新增域默认开放 HTTP 提交；若某域需禁，在此显式排除并注明理由。
 */
export const HTTP_TASK_DOMAINS: readonly TaskDomain[] = TASK_DOMAINS

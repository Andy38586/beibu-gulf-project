import type { TaskDomain, TaskPriority } from '../types/task'

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

/** 支持的任务域由 TaskHandlers 提供，这里只声明「业务侧允许通过 HTTP 提交的域」 */
export const HTTP_TASK_DOMAINS: readonly TaskDomain[] = [
  'flood-areas',
  'route-path',
  'site-analysis',
  'forecast-timeseries',
] as const
